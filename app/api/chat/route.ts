import { generateJSON } from "../../lib/gemini";
import { trimTraits } from "../../lib/cache";
import { fallbackChat } from "../../lib/fallback";

export const maxDuration = 60;

type Trait = { id: string; label: string; type: string; source: string };
type Conflict = { label: string; newLabel: string; newType: string; question: string };
type Facts = {
  majors?: string[] | null;
  status?: string | null;
  gradTerm?: string | null;
  gradYear?: number | null;
  hoursPerWeek?: number | null;
};

// One Gemini call per message: update the profile ONLY from what the user said, and ask one follow-up question.
const PROMPT = `You are a career coach. You only listen and ask. You never recommend careers here.
From the NEW message only, extract 0-3 traits the user stated about themselves.
Types: strength (good at), interest (enjoys), value (cares about), dislike (avoids).
Use only what they actually said. Do not guess or add anything they did not say. "Useless" talents count.
Do not repeat traits already in currentTraits.
If contextNote is given, the message answers a question about a career or an activity: extract traits ONLY from what they say
about themselves, never from the career's or activity's own description.
upgrades: if the NEW message shows an existing "interest" in currentTraits is also something they are GOOD at, list it:
[{"label":"the existing trait label exactly","newLabel":"short strength wording, or null"}]. Otherwise [].
conflicts: if the NEW message contradicts a trait in currentTraits (e.g. existing interest "baking" but now "I don't like
baking anymore"), do NOT change it and do NOT put the contradicting trait in newTraits. List it instead (at most 1):
[{"label":"existing label exactly","newLabel":"short wording","newType":"strength|interest|value|dislike",
  "question":"one friendly question naming both and asking whether to update"}]. Otherwise [].
resolve: only when pendingConflict is given. "update" if the message agrees the old trait should change, "keep" if not,
null if the message does not answer it.
facts: background the user stated in THIS message, else null for each field.
 majors: list of their majors/fields of study (e.g. ["Computer Science"]); status: one of freshman, sophomore, junior,
 senior, grad, graduated, notInSchool; gradTerm: spring|summer|fall|winter; gradYear: number; hoursPerWeek: hours they can
 spend on career prep each week.
followUp: ONE short, light question that helps them learn about themselves, connected to what they just said, or null.
 Never ask what they already answered (see earlierMessages). If conflicts is not empty, followUp is null.
Output valid JSON with no trailing commas:
{"newTraits":[{"id":"kebab-id","label":"...","type":"strength|interest|value|dislike","source":"the user's own words"}],
 "upgrades":[],"conflicts":[],"resolve":null,
 "facts":{"majors":null,"status":null,"gradTerm":null,"gradYear":null,"hoursPerWeek":null},
 "followUp":"... or null"}`;

const STATUSES = ["freshman", "sophomore", "junior", "senior", "grad", "graduated", "notInSchool"];
const TERMS = ["spring", "summer", "fall", "winter"];

export async function POST(req: Request) {
  try {
    const {
      message,
      traits = [] as Trait[],
      history = [] as string[],
      context = null,
      pendingConflict = null as Conflict | null,
    } = await req.json();

    let out: {
      newTraits?: Trait[];
      upgrades?: { label: string; newLabel?: string | null }[];
      conflicts?: Conflict[];
      resolve?: string | null;
      facts?: Facts | null;
      followUp?: string | null;
    };
    try {
      out = await generateJSON(
        PROMPT,
        {
          newMessage: message,
          contextNote: context,
          currentTraits: trimTraits(traits as Trait[]),
          pendingConflict,
          earlierMessages: (history as string[]).slice(-15),
        },
        { timeoutMs: 20000 }
      );
    } catch (e) {
      // Gemini out of quota or too slow: simple rules on the user's own words instead.
      console.warn("chat: using no-AI fallback:", String(e).slice(0, 120));
      out = fallbackChat({ message, traits: traits as Trait[], history: history as string[], pendingConflict });
    }

    const known = new Set((traits as Trait[]).map((t) => t.label.toLowerCase()));
    const conflicts = (out.conflicts ?? [])
      .filter((c) => c?.label && c?.newLabel && c?.question && known.has(c.label.toLowerCase()))
      .slice(0, 1);
    const conflictWords = new Set(conflicts.flatMap((c) => [c.label.toLowerCase(), c.newLabel.toLowerCase()]));
    const newTraits = (out.newTraits ?? []).filter(
      (t) => t?.label && !known.has(t.label.toLowerCase()) && !conflictWords.has(t.label.toLowerCase())
    );
    const pc = pendingConflict as Conflict | null;
    const resolve = pc && (out.resolve === "update" || out.resolve === "keep") ? out.resolve : null;

    // Background facts: keep only clean values the user actually stated.
    const f: Facts = out.facts ?? {};
    const facts: Facts = {};
    if (Array.isArray(f.majors) && f.majors.length) facts.majors = f.majors.map(String).filter(Boolean).slice(0, 4);
    if (f.status && STATUSES.includes(f.status)) facts.status = f.status;
    if (f.gradTerm && TERMS.includes(f.gradTerm)) facts.gradTerm = f.gradTerm;
    const gy = Number(f.gradYear);
    if (Number.isInteger(gy) && gy > 1950 && gy < 2100) facts.gradYear = gy;
    const hw = Number(f.hoursPerWeek);
    if (hw > 0 && hw <= 60) facts.hoursPerWeek = Math.round(hw);

    return Response.json({
      newTraits,
      upgrades: (out.upgrades ?? []).filter((u) => u?.label),
      facts,
      conflict: conflicts[0] ?? null,
      replaced: resolve === "update" ? pc : null,
      conflictDone: !!resolve,
      followUp: conflicts.length ? null : out.followUp ?? null,
    });
  } catch (error) {
    console.error("chat error:", error);
    const busy = /429|RESOURCE_EXHAUSTED/.test(String(error));
    return Response.json({ error: busy ? "quota" : String(error) }, { status: busy ? 429 : 500 });
  }
}
