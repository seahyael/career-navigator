import { AI_LANG_RULE, type Lang } from "../../i18n";
import { fetchOnet } from "../../lib/onet";
import { generateJSON } from "../../lib/gemini";
import { getMarket, trimTraits } from "../../lib/cache";

export const maxDuration = 60;


type Career = { id: string; title: string; summary?: string; skills?: string[]; onetCode?: string; field?: string };

async function marketEvidence(ids: string[]) {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const a = (await getMarket(id))?.analysis as
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
    }
  }
  return out;
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
Use onetData (official requirements) and marketEvidence (counts from real LinkedIn postings) to decide WHAT to build.
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
      userTraits: trimTraits(traits as { type: string }[]),
      majors,
      confirmedField: field,
      completedTasks: (completedTasks as unknown[]).slice(-30),
      decisions,
      onetData,
      marketEvidence: evidence,
    };

    const data = await generateJSON(
      `${PROMPT}\n\nLANGUAGE: ${rule} Keep label, kind, careers, careerId and option "title" values exactly as specified (English).`,
      payload,
      { temperature: 0.4 }
    );
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
