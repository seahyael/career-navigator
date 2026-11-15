// No-AI fallback used when Gemini is out of quota or too slow.
// Simple rules on the user's own words, real O*NET-coded careers, and LinkedIn postings counted in code.
import careersData from "../../data/careers.json";
import subfieldsData from "../../data/subfields.json";
import type { Career } from "./pool";

type Trait = { id: string; label: string; type: string; source: string };
type Conflict = { label: string; newLabel: string; newType: string; question: string };

// ---------- Chat ----------

const PATTERNS: { type: string; re: RegExp }[] = [
  { type: "dislike", re: /\b(?:i\s+)?(?:don'?t|do not|never)\s+(?:really\s+)?(?:like|enjoy|love|want)\s+(.+)/i },
  { type: "dislike", re: /\bi\s+(?:hate|dislike|can'?t stand|avoid)\s+(.+)/i },
  { type: "dislike", re: /\bnot a fan of\s+(.+)/i },
  { type: "strength", re: /\bi(?:'m| am)\s+(?:really\s+|pretty\s+|very\s+)?(?:good|great|skilled)\s+at\s+(.+)/i },
  { type: "strength", re: /\bpeople (?:ask me|say i'?m good) (?:for help with|at)\s+(.+)/i },
  { type: "value", re: /\bi\s+care\s+(?:a lot\s+)?about\s+(.+)/i },
  { type: "value", re: /\bit'?s important (?:to me )?(?:to|that)\s+(.+)/i },
  { type: "interest", re: /\bi\s+(?:really\s+)?(?:love|like|enjoy|adore)\s+(.+)/i },
  { type: "interest", re: /\bi(?:'m| am)\s+(?:really\s+)?into\s+(.+)/i },
  { type: "interest", re: /\bmy (?:hobby|hobbies) (?:is|are)\s+(.+)/i },
  { type: "interest", re: /\bi\s+(?:worked|work)\s+(?:at|in|as)\s+(.+)/i },
  { type: "interest", re: /\bi\s+(?:sing|draw|paint|bake|cook|dance|write|code|play)\b(.*)/i },
];

function cleanLabel(raw: string, whole?: string) {
  let s = raw
    .replace(/\b(a lot|so much|very much|anymore|any more|really|actually|honestly)\b/gi, "")
    .replace(/[^a-z0-9'&\- ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s && whole) s = whole;
  return s.split(" ").slice(0, 4).join(" ").toLowerCase();
}

function words(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "with", "eating", "doing", "making"].includes(w));
}

function overlaps(a: string, b: string) {
  const wa = new Set(words(a));
  return words(b).some((w) => wa.has(w) || [...wa].some((x) => x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4))));
}

const STATUS: [RegExp, string][] = [
  [/\b(already graduated|i graduated|graduated (?:from|in|with))\b/i, "graduated"],
  [/\b(freshman|first[- ]year|1st[- ]year)\b/i, "freshman"],
  [/\b(sophomore|second[- ]year|2nd[- ]year)\b/i, "sophomore"],
  [/\b(junior|third[- ]year|3rd[- ]year)\b/i, "junior"],
  [/\b(senior|fourth[- ]year|4th[- ]year)\b/i, "senior"],
  [/\b(grad student|graduate student|master'?s|phd)\b/i, "grad"],
  [/\b(not in school|working full[- ]time|career change)\b/i, "notInSchool"],
];

const FOLLOW_UPS: Record<string, (l: string) => string> = {
  interest: (l) => `What do you enjoy most about ${l}?`,
  strength: (l) => `Where did you get good at ${l}?`,
  dislike: (l) => `What part of ${l} don't you like?`,
  value: (l) => `Why does ${l} matter to you?`,
};
const GENERIC = [
  "What's something you lose track of time doing?",
  "What do friends usually ask you for help with?",
  "Do you get more energy working with people or on your own?",
  "What's a small thing you're proud of making or doing?",
];

export function fallbackChat(opts: {
  message: string;
  traits: Trait[];
  history: string[];
  pendingConflict: Conflict | null;
}) {
  const msg = String(opts.message ?? "");
  const known = opts.traits;

  // Answering a "should I update that?" question
  let resolve: "update" | "keep" | null = null;
  if (opts.pendingConflict) {
    if (/^\s*(yes|yeah|yep|yup|sure|ok|okay|update|please|do it|change)/i.test(msg)) resolve = "update";
    else if (/^\s*(no|nope|nah|keep|don'?t)/i.test(msg)) resolve = "keep";
  }

  const newTraits: Trait[] = [];
  let conflict: Conflict | null = null;
  const parts = msg
    .split(/[.!?;\n]+|,\s*(?:and|but)\s+|\s+but\s+|\s+and\s+(?=(?:i|i'm|im|my)\b)/i)
    .filter((p) => p.trim());
  for (const part of parts) {
    for (const { type, re } of PATTERNS) {
      const m = part.match(re);
      if (!m) continue;
      const label = cleanLabel(m[1] ?? "", part.trim());
      if (!label || label.length < 3) break;
      // contradicts something said before: ask first, change nothing
      const clash = known.find(
        (k) => overlaps(k.label, label) && (type === "dislike") !== (k.type === "dislike")
      );
      if (clash && !conflict && !resolve) {
        conflict = {
          label: clash.label,
          newLabel: label,
          newType: type,
          question: `Earlier you said "${clash.label}", but now "${label}" sounds different. Should I update that?`,
        };
      } else if (!known.some((k) => k.label.toLowerCase() === label) && !newTraits.some((t) => t.label === label)) {
        newTraits.push({ id: label.replace(/\s+/g, "-"), label, type, source: part.trim() });
      }
      break;
    }
  }

  const facts: Record<string, unknown> = {};
  const major =
    msg.match(/\b(?:i'?m|i am)\s+(?:a\s+)?(?:\w+[- ]year\s+)?([a-z &]{2,30}?)\s+major\b/i)?.[1] ??
    msg.match(/\bmajor(?:ing)?\s+in\s+([a-z &]{2,30})/i)?.[1] ??
    msg.match(/\bgraduated\s+(?:in|with a degree in)\s+([a-z &]{2,30})/i)?.[1];
  if (major && !/^\d/.test(major)) facts.majors = [major.trim().replace(/\b\w/g, (c) => c.toUpperCase())];
  for (const [re, st] of STATUS) if (re.test(msg)) {
    facts.status = st;
    break;
  }
  const term = msg.match(/\b(spring|summer|fall|winter)\s+(20\d\d)\b/i);
  if (term) {
    facts.gradTerm = term[1].toLowerCase();
    facts.gradYear = Number(term[2]);
  } else {
    const y = msg.match(/\bgraduat\w*\s+(?:in\s+)?(20\d\d)\b/i);
    if (y) facts.gradYear = Number(y[1]);
  }
  const hours = msg.match(/\b(\d{1,2})\s*(?:hours|hrs|h)\s*(?:a|per)\s*week\b/i);
  if (hours) facts.hoursPerWeek = Number(hours[1]);

  let followUp: string | null = null;
  if (!conflict) {
    const first = newTraits[0];
    const asked = new Set(opts.history.map((h) => h.toLowerCase()));
    followUp = first ? FOLLOW_UPS[first.type]?.(first.label) ?? null : null;
    if (!followUp && !resolve && !Object.keys(facts).length) {
      followUp = GENERIC.find((g) => !asked.has(g.toLowerCase())) ?? GENERIC[0];
    }
  }

  return { newTraits, upgrades: [], conflicts: conflict ? [conflict] : [], resolve, facts, followUp };
}

// ---------- Careers ----------

// A few extra real O*NET occupations so hobbies like food, music or art have matches.
const EXTRA: Career[] = [
  { id: "onet-51-3011.00", title: "Bakers", onetCode: "51-3011.00", field: "Food & Hospitality", summary: "Mix and bake breads, pastries, and other baked goods.", skills: ["Baking", "Recipe planning", "Food safety"] },
  { id: "onet-35-1011.00", title: "Chefs and Head Cooks", onetCode: "35-1011.00", field: "Food & Hospitality", summary: "Plan menus and lead kitchen teams.", skills: ["Cooking", "Menu design", "Team leadership"] },
  { id: "onet-11-9051.00", title: "Food Service Managers", onetCode: "11-9051.00", field: "Food & Hospitality", summary: "Run restaurants, cafes, and bakeries day to day.", skills: ["Operations", "Customer service", "Budgeting"] },
  { id: "onet-19-1012.00", title: "Food Scientists and Technologists", onetCode: "19-1012.00", field: "Science", summary: "Study and improve how food is made and kept safe.", skills: ["Chemistry", "Testing", "Product development"] },
  { id: "onet-29-1031.00", title: "Dietitians and Nutritionists", onetCode: "29-1031.00", field: "Healthcare", summary: "Help people eat well for their health.", skills: ["Nutrition", "Counseling", "Meal planning"] },
  { id: "onet-27-2042.00", title: "Musicians and Singers", onetCode: "27-2042.00", field: "Arts & Music", summary: "Perform music live or in recordings.", skills: ["Singing", "Performance", "Practice discipline"] },
  { id: "onet-27-2041.00", title: "Music Directors and Composers", onetCode: "27-2041.00", field: "Arts & Music", summary: "Write music and lead choirs or ensembles.", skills: ["Composition", "Leadership", "Music theory"] },
  { id: "onet-29-1129.02", title: "Music Therapists", onetCode: "29-1129.02", field: "Healthcare", summary: "Use music to help people's health and wellbeing.", skills: ["Music", "Empathy", "Listening"] },
  { id: "onet-27-1013.00", title: "Fine Artists, Including Painters, Sculptors, and Illustrators", onetCode: "27-1013.00", field: "Arts & Music", summary: "Create original art and illustrations.", skills: ["Drawing", "Creativity", "Visual storytelling"] },
  { id: "onet-27-1025.00", title: "Interior Designers", onetCode: "27-1025.00", field: "Design", summary: "Plan spaces that look good and work well.", skills: ["Space planning", "Drawing", "Client communication"] },
  { id: "onet-27-4021.00", title: "Photographers", onetCode: "27-4021.00", field: "Arts & Music", summary: "Capture and edit photos for clients or media.", skills: ["Photography", "Editing", "Composition"] },
  { id: "onet-13-1121.00", title: "Meeting, Convention, and Event Planners", onetCode: "13-1121.00", field: "Business", summary: "Organize events from start to finish.", skills: ["Organizing", "Negotiation", "Communication"] },
  { id: "onet-21-1021.00", title: "Child, Family, and School Social Workers", onetCode: "21-1021.00", field: "Social Services", summary: "Support children and families through hard times.", skills: ["Listening", "Empathy", "Case management"] },
  { id: "onet-25-4022.00", title: "Librarians and Media Collections Specialists", onetCode: "25-4022.00", field: "Education", summary: "Organize information and help people find it.", skills: ["Organizing", "Research", "Helping people"] },
  { id: "onet-17-2141.00", title: "Mechanical Engineers", onetCode: "17-2141.00", field: "Engineering", summary: "Design and test machines and devices.", skills: ["Problem solving", "CAD", "Physics"] },
  { id: "onet-47-2111.00", title: "Electricians", onetCode: "47-2111.00", field: "Skilled Trades", summary: "Install and repair electrical systems.", skills: ["Wiring", "Troubleshooting", "Safety"] },
  { id: "onet-15-1255.01", title: "Video Game Designers", onetCode: "15-1255.01", field: "Computer Science", summary: "Design game ideas, levels, and rules.", skills: ["Game design", "Storytelling", "Prototyping"] },
  { id: "onet-27-3043.00", title: "Writers and Authors", onetCode: "27-3043.00", field: "Communications", summary: "Write stories, articles, and scripts.", skills: ["Writing", "Research", "Editing"] },
  { id: "onet-11-2021.00", title: "Marketing Managers", onetCode: "11-2021.00", field: "Business", summary: "Plan how products reach the right people.", skills: ["Strategy", "Creativity", "Data analysis"] },
];

// Everyday words mapped to career words, so "bread" finds bakers and "sing" finds musicians.
const SYNONYMS: Record<string, string[]> = {
  bread: ["baking", "baker", "bakers", "food", "pastries", "cafes"],
  bake: ["baking", "bakers", "food"],
  baking: ["bakers", "food", "pastries"],
  cook: ["cooking", "chefs", "food", "kitchen", "menu"],
  food: ["food", "chefs", "bakers", "nutrition", "restaurants"],
  eat: ["food", "nutrition", "chefs"],
  sing: ["singing", "musicians", "singers", "music", "choirs"],
  music: ["music", "musicians", "composition", "choirs"],
  choir: ["choirs", "singing", "music"],
  perform: ["performance", "musicians", "singers"],
  draw: ["drawing", "illustrations", "artists", "sketch"],
  drawing: ["drawing", "illustrations", "artists", "sketch"],
  art: ["artists", "creativity", "illustrations"],
  design: ["design", "designers", "drawing", "visual"],
  friend: ["listening", "empathy", "counseling", "helping", "social"],
  listen: ["listening", "empathy", "counseling", "therapists"],
  help: ["helping", "counseling", "social", "support"],
  organiz: ["organizing", "operations", "planning", "managers", "planners"],
  plan: ["planning", "planners", "strategy"],
  work: ["engineers", "machines", "problem", "troubleshooting"],
  fix: ["repair", "troubleshooting", "engineers", "electricians"],
  code: ["software", "developers", "programming", "computer"],
  coding: ["software", "developers", "programming", "computer"],
  computer: ["computer", "software", "data"],
  game: ["game", "games", "designers"],
  write: ["writing", "writers", "editing"],
  photo: ["photography", "photographers"],
  people: ["communication", "customer", "helping", "team"],
};

function expand(label: string) {
  const out = new Set(words(label));
  for (const w of [...out]) {
    for (const [k, vals] of Object.entries(SYNONYMS)) if (w.startsWith(k) || k.startsWith(w)) vals.forEach((v) => out.add(v));
  }
  return [...out];
}

export function fallbackCareers(opts: {
  traits: { label: string; type: string }[];
  majors: string[];
  notInterested: string[];
  howMany?: number;
}) {
  const pool: Career[] = [];
  const seen = new Set<string>();
  const subfields = subfieldsData as unknown as Record<string, Career[]>;
  for (const c of [...EXTRA, ...(careersData as unknown as Career[]), ...Object.values(subfields).flat()]) {
    const key = c.onetCode ?? c.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(c);
  }
  const blocked = new Set(opts.notInterested.map((t) => t.toLowerCase()));
  const weight: Record<string, number> = { strength: 3, interest: 2, value: 1, dislike: -3 };
  const majorWords = opts.majors.flatMap((m) => expand(m));

  const scored = pool
    .filter((c) => !blocked.has(c.title.toLowerCase()) && !blocked.has(c.id))
    .map((c) => {
      const text = `${c.title} ${c.summary} ${(c.skills ?? []).join(" ")}`.toLowerCase();
      const fieldText = `${text} ${c.field ?? ""}`.toLowerCase();
      const has = (w: string) => new RegExp(`\\b${w.replace(/[^a-z0-9]/g, "")}`).test(text);
      const hasInField = (w: string) => new RegExp(`\\b${w.replace(/[^a-z0-9]/g, "")}`).test(fieldText);
      let score = 0;
      const hits: string[] = [];
      for (const t of opts.traits) {
        const terms = expand(t.label);
        if (terms.some(has)) {
          score += weight[t.type] ?? 1;
          if (t.type !== "dislike" && hits.length < 2) hits.push(t.label);
        }
      }
      const majorHit = majorWords.some(hasInField);
      if (majorHit) score += 1.5;
      return { c, score, hits, majorHit };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.howMany ?? 15);

  const top = Math.max(1, scored[0]?.score ?? 1);
  return scored.map(({ c, score, hits, majorHit }) => ({
    ...c,
    score: Math.max(30, Math.min(95, Math.round(45 + (score / top) * 50))),
    reason: hits.length >= 2 ? `Connects your ${hits[0]} and ${hits[1]}.` : hits.length ? `Builds on your ${hits[0]}.` : majorHit ? `Uses your ${opts.majors[0]} background.` : "Worth a look given your profile.",
  }));
}

// ---------- Roadmap ----------

type BoardCareer = { id: string; title: string; skills?: string[]; onetCode?: string };
type Evidence = Record<string, { postingsCount?: number; skills?: { name: string; count: number }[]; rawPostings?: string[] }>;

const SEASONS = ["Winter", "Spring", "Summer", "Fall"];
function termsFromNow(n: number) {
  const d = new Date();
  let i = Math.floor(d.getMonth() / 3);
  let y = d.getFullYear();
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    out.push(`${SEASONS[i]} ${y}`);
    i += 1;
    if (i === 4) {
      i = 0;
      y += 1;
    }
  }
  return out;
}

export function fallbackPlan(opts: {
  careers: BoardCareer[];
  timeline: { status?: string; gradTerm?: string; gradYear?: number | null; hoursPerWeek?: number };
  evidence: Evidence;
}) {
  const list = opts.careers.slice(0, 6);
  const status = opts.timeline.status ?? "";
  const late = ["senior", "graduated", "notInSchool"].includes(status);
  const grad = status === "grad";

  // Skills with real posting counts when we have them; O*NET skills otherwise.
  const skillTasks: { text: string; why: string; careers: string[]; evidence: string | null; label: string }[] = [];
  for (const c of list) {
    const ev = opts.evidence[c.id];
    let skills: { name: string; count?: number; total?: number }[] = [];
    if (ev?.skills?.length) {
      skills = ev.skills.slice(0, 2).map((s) => ({ name: s.name, count: s.count, total: ev.postingsCount }));
    } else if (ev?.rawPostings?.length) {
      const posts = ev.rawPostings.map((p) => p.toLowerCase());
      skills = (c.skills ?? [])
        .map((s) => ({ name: s, count: posts.filter((p) => words(s).some((w) => p.includes(w))).length, total: posts.length }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .slice(0, 2);
    } else {
      skills = (c.skills ?? []).slice(0, 2).map((s) => ({ name: s }));
    }
    for (const s of skills) {
      const counted = s.total && s.count !== undefined && s.count > 0;
      skillTasks.push({
        text: `Build ${s.name} with one small, finished project`,
        why: `Needed for ${c.title}.`,
        careers: [c.id],
        evidence: counted ? `${s.count}/${s.total} postings` : c.onetCode ? "O*NET" : null,
        label: counted || c.onetCode ? "required" : "recommended",
      });
    }
  }

  const terms = termsFromNow(late ? 3 : 5);
  const titles = list.map((c) => c.title);
  const stages = [];
  if (!late) {
    stages.push({
      title: grad ? "Focus your research" : "Explore and test",
      when: terms[0],
      goal: grad ? "Connect your research to the careers you like." : "Try each career in a small way before committing.",
      milestone: `Try 1 small activity for each of ${list.length} careers`,
      tasks: [
        ...list.slice(0, 3).map((c) => ({
          text: `Talk to one person who works as ${c.title}`,
          label: "explore",
          why: "Real stories show what the job is like day to day.",
          careers: [c.id],
          evidence: null,
        })),
      ],
      decision: list.length > 1
        ? {
            question: "Which careers do you want to focus on next?",
            why: "Pick the ones that felt best after trying them.",
            kind: "career",
            options: list.slice(0, 4).map((c) => ({ label: c.title, careerId: c.id })),
          }
        : null,
    });
  }
  stages.push({
    title: "Build core skills",
    when: terms[late ? 0 : 1],
    goal: "Learn the skills employers ask for most.",
    milestone: `Finish ${Math.min(skillTasks.length, 4)} skill projects`,
    tasks: skillTasks.slice(0, 4),
    decision: null,
  });
  stages.push({
    title: "Get real experience",
    when: terms[late ? 1 : 2],
    goal: "Show you can do the work.",
    milestone: "1 internship, part-time job, or volunteer role",
    tasks: [
      { text: "Apply to 5 internships or part-time roles", label: "required", why: "Experience is what most postings ask for.", careers: ["all"], evidence: null },
      { text: "Put your best projects in a simple portfolio", label: "recommended", why: "It makes your skills easy to see.", careers: ["all"], evidence: null },
    ],
    decision: null,
  });
  stages.push({
    title: "Apply and launch",
    when: opts.timeline.gradYear ? `Before ${opts.timeline.gradTerm ? opts.timeline.gradTerm + " " : ""}${opts.timeline.gradYear}` : terms[late ? 2 : 4],
    goal: "Land your first role in the path you chose.",
    milestone: "10 applications and 3 interviews",
    tasks: [
      { text: "Update your resume for each target role", label: "required", why: "Recruiters scan for the skills in the posting.", careers: ["all"], evidence: null },
      { text: "Practice 3 mock interviews", label: "recommended", why: "Confidence comes from practice.", careers: ["all"], evidence: null },
    ],
    decision: null,
  });

  return {
    summary: `A ${stages.length}-stage plan toward ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? " and more" : ""}.`,
    stages,
  };
}
