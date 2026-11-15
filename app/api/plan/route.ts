import { AI_LANG_RULE, type Lang } from "../../i18n";
import { fetchOnet } from "../../lib/onet";
import { generateJSON } from "../../lib/gemini";
import { fallbackPlan } from "../../lib/fallback";
import { getMarket, trimTraits } from "../../lib/cache";

export const maxDuration = 60;


type Career = { id: string; title: string; summary?: string; skills?: string[]; onetCode?: string; field?: string };

// LinkedIn evidence for each career: the saved analysis when there is one, otherwise the raw postings collected
// when the career was added to the roadmap (the roadmap call counts those itself, so no extra AI call is needed).
async function marketEvidence(ids: string[]) {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const entry = await getMarket(id);
    const a = entry?.analysis as
      | { postingsCount?: number; skills?: { name: string; count: number }[]; certifications?: unknown[]; degrees?: unknown[] }
      | null
      | undefined;
    if (a) {
      out[id] = {
        postingsCount: a.postingsCount,
        skills: (a.skills ?? []).map((s) => ({ name: s.name, count: s.count })),
        certifications: a.certifications ?? [],
        degrees: a.degrees ?? [],
      };
    } else if (entry?.postings?.length) {
      const posts = (entry.postings as { job_title?: string; job_summary?: string }[])
        .filter((p) => p && (p.job_title || p.job_summary))
        .slice(0, 10);
      if (posts.length) {
        out[id] = {
          postingsCount: posts.length,
          rawPostings: posts.map((p) => `${p.job_title ?? ""}: ${(p.job_summary ?? "").slice(0, 400)}`),
        };
      }
    }
  }
  return out;
}

// What fits each point in school, so a 1st-year and a grad student get very different roadmaps.
const STAGE_GUIDE: Record<string, string> = {
  freshman:
    "1st-year undergrad. Lots of time. Focus on exploring: intro and gen-ed courses that test several careers, clubs, small " +
    "side projects, talking to upperclassmen and professors. Major/minor decision comes later (around end of 2nd year). " +
    "First internship target: summer after 2nd or 3rd year.",
  sophomore:
    "2nd-year undergrad. Narrow from exploring to choosing: decide major/minor this year, take the first core courses, build " +
    "1-2 portfolio projects, apply to first internships or research assistant roles for next summer.",
  junior:
    "3rd-year undergrad. Internship year: apply in the fall for next summer, deepen core skills, build a portfolio, network with " +
    "alumni. Specialization decision now. Job search starts at the beginning of next year.",
  senior:
    "4th-year undergrad, graduating soon. No exploring stages. Start applications right away (full-time roles, return offers, " +
    "new-grad programs), polish resume and portfolio, network actively, prep interviews, and plan a backup (grad school, " +
    "contract work, bridge job) for after graduation.",
  grad:
    "Graduate student (master's or PhD). Already specialized: skip undergrad steps. Focus on research, thesis or capstone, " +
    "advisor and lab, publishing or presenting at conferences, specialized or research internships, academic vs industry " +
    "decision, and professional networking in their niche.",
  graduated:
    "Already graduated. Skip all school steps (courses, majors, internships for students). Focus on landing or switching " +
    "into a first role: portfolio or projects that prove skills, certifications, networking, applications and interviews, " +
    "and early-career growth after they are hired.",
  notInSchool:
    "Not in school (working, career changer, or taking a break). Use calendar quarters. Focus on certifications, bootcamps or " +
    "online courses, portfolio projects, transferable experience from current or past jobs, informational interviews, and a " +
    "career-switch job search. Fit everything around a job.",
};
const TERM_MONTH: Record<string, number> = { winter: 3, spring: 5, summer: 8, fall: 12 };

function monthsLeft(t: { gradTerm?: string; gradYear?: number | null }) {
  if (!t?.gradYear) return null;
  const now = new Date();
  const m = TERM_MONTH[t.gradTerm ?? ""] ?? 5;
  return Math.max(0, (t.gradYear - now.getFullYear()) * 12 + (m - (now.getMonth() + 1)));
}

const PROMPT = `You are a career coach. Build ONE comprehensive roadmap for a student who is still exploring.
They are interested in SEVERAL careers (careers). Do not pick one for them. The roadmap should:
- Start broad: early stages build on the student's STRENGTHS and preferences and keep several careers open
  (tasks that help many of their careers come first).
- Narrow over time: place 1-3 DECISION points at natural moments (after they have tried something, before choosing courses or
  declaring a major/minor, before internship applications). Decisions are how specialization, major and field get chosen
  WHILE following the roadmap, not before.
- End with a realistic job search for whatever they choose (start applying 6-9 months before graduation).
- Respect decisions already made (decisions) and build on completed tasks (completedTasks; do not repeat them).
  If they disliked a kind of task, offer a gentler alternative, but keep required ones.
- Fit the work to timeline.hoursPerWeek and tie every stage to a real term on their calendar from today
  (e.g. "Spring 2027", "Summer 2027"); if not in school, use calendar quarters.
- FOLLOW whereNow strictly. It says where the student is today and what fits this point in their life. The first stage
  must start NOW (today's term) and match whereNow; never include steps they are already past (no "explore majors" for a senior,
  no gen-ed courses for a grad student). Use monthsLeft to set the pace: fewer months = fewer, denser stages that reach
  applications quickly; more months = room to explore first.
Use onetData (official requirements) and marketEvidence (real LinkedIn postings) to decide WHAT to build.
marketEvidence gives either counted skills, or rawPostings: then count yourself how many of those postings mention the
skill, and write evidence as "<count>/<postingsCount> postings". Never invent counts.
Never use postings to judge fit.

4-6 stages in time order. Each stage: title, when, goal (one sentence), milestone (concrete, countable),
2-4 tasks, and optionally one decision.
Task: text (specific, under 14 words), label ("required" = needed to get hired in the careers it serves, backed by O*NET or frequent
in postings; "recommended" = builds on their strengths/preferences; "explore" = a light test of fit),
why (one short sentence), careers (array of career ids it serves, or ["all"]), evidence ("11/15 postings", "O*NET", or null).
Decision: question, why (one sentence: why decide now and how to decide), kind ("career" = which careers to keep,
"specialization" = a more specific role inside one career, "major" = major/minor, "field"), and 2-4 options.
Option: label (short), careerId (for kind "career" or the parent career of a specialization), and for "specialization" also
title (common English job title), summary, skills (3 items).
summary: 1-2 sentences on the overall journey and the target date for a first job.
Valid JSON only, no trailing commas:
{"summary":"...","stages":[{"id":"kebab","title":"...","when":"...","goal":"...","milestone":"...",
 "tasks":[{"id":"kebab","text":"...","label":"required|recommended|explore","why":"...","careers":["..."],"evidence":"... or null"}],
 "decision":{"id":"kebab","question":"...","why":"...","kind":"career|specialization|major|field",
  "options":[{"label":"...","careerId":"...","title":"...","summary":"...","skills":["..."]}]}}]}`;


export async function POST(req: Request) {
  try {
    const {
      careers = [] as Career[],
      traits = [],
      majors = [],
      field = null,
      timeline = {},
      completedTasks = [],
      decisions = [],
      lang = "en",
    } = await req.json();
    if (!careers.length) return Response.json({ error: "no careers" }, { status: 400 });
    const rule = AI_LANG_RULE[(lang as Lang) in AI_LANG_RULE ? (lang as Lang) : "en"];
    const list = (careers as Career[]).slice(0, 6);

    const [evidence, onetResults] = await Promise.all([
      marketEvidence(list.map((c) => c.id)),
      Promise.all(
        list.slice(0, 3).map(async (c) => {
          if (!c.onetCode) return null;
          const r = await fetchOnet(c.onetCode);
          return r.ok ? { careerId: c.id, data: JSON.stringify(r.data).slice(0, 3000) } : null;
        })
      ),
    ]);
    const onetData = onetResults.filter(Boolean);

    const payload = {
      careers: list.map((c) => ({ id: c.id, title: c.title, summary: c.summary, skills: c.skills, field: c.field })),
      today: new Date().toISOString().slice(0, 10),
      timeline,
      whereNow:
        STAGE_GUIDE[(timeline as { status?: string })?.status ?? ""] ??
        "Unknown stage: assume an undergrad in the middle of their studies and ask about it in the first stage's goal.",
      monthsLeft: monthsLeft(timeline as { gradTerm?: string; gradYear?: number | null }),
      userTraits: trimTraits(traits as { type: string }[]),
      majors,
      confirmedField: field,
      completedTasks: (completedTasks as unknown[]).slice(-30),
      decisions,
      onetData,
      marketEvidence: evidence,
    };

    let data;
    try {
      data = await generateJSON(
        `${PROMPT}\n\nLANGUAGE: ${rule} Keep label, kind, careers, careerId and option "title" values exactly as specified (English).`,
        payload,
        { temperature: 0.4, timeoutMs: 40000 }
      );
    } catch (e) {
      // Gemini out of quota or too slow: a template roadmap built from O*NET skills and LinkedIn counts done in code.
      console.warn("plan: using no-AI fallback:", String(e).slice(0, 120));
      data = fallbackPlan({ careers: list, timeline: timeline as never, evidence: evidence as never });
    }
    const labels = ["required", "recommended", "explore"];
    const stamp = Date.now().toString(36);
    const stages = (data.stages ?? []).map(
      (
        st: {
          id?: string;
          tasks?: { id?: string; label: string }[];
          decision?: { id?: string; options?: unknown[] } | null;
        },
        i: number
      ) => ({
        ...st,
        id: `st-${stamp}-${i}`,
        tasks: (st.tasks ?? [])
          .filter((t) => labels.includes(t.label))
          .map((t, j) => ({ ...t, id: `tk-${stamp}-${i}-${j}` })),
        decision: st.decision?.options?.length ? { ...st.decision, id: `dc-${stamp}-${i}` } : null,
      })
    );
    return Response.json({
      summary: data.summary ?? "",
      stages,
      sources: {
        onet: onetData.length > 0,
        linkedin: Object.keys(evidence).length > 0,
        linkedinFor: Object.keys(evidence),
      },
    });
  } catch (error) {
    console.error("plan error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
