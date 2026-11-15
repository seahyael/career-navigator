import careers from "../../../data/careers.json";
import { fieldPool, growPool, type Career } from "../../lib/pool";
import { generateJSON } from "../../lib/gemini";
import { AI_LANG_RULE, type Lang } from "../../i18n";

type Trait = { id: string; label: string; type: string; source: string };
type Rank = { id: string; score: number; reason: string; titleKo?: string };


// Step 1: read only the new message, extract traits, react.
const EXTRACT_PROMPT = `You are a warm career coach for students who feel lost.
The user talks casually. From the NEW message only, extract 0-3 traits.
Types: strength (good at), interest (enjoys), value (cares about), dislike (avoids).
Read between the lines: "lost track of time helping a friend" -> strength: empathy, interest: helping people.
"Useless" talents count. Never mock them; find how they transfer to work.
Do not repeat traits already in currentTraits.
If contextNote is given, the new message is the user's reflection after trying an activity. Extract traits ONLY from what they say
about themselves (what they enjoyed, found hard or easy, noticed about themselves), never from the activity's own description.
upgrades: if the NEW message shows that an existing "interest" in currentTraits is also something they are GOOD at
(they practice it often, finished real things with it, get praise, people ask them for help with it), list it so it moves to strengths:
[{"label":"the existing trait label exactly","newLabel":"a short strength wording, or null to keep the label"}]. Otherwise [].
reply: 1-2 friendly sentences reacting to what they said, connecting it to something they said earlier when possible.
followUp: ONE light, specific question, or null.
 - If contextNote is given (the user just explained a choice or reflected on an activity), react to it; ask a follow-up only if
   their answer opens something worth exploring.
 - Only when the profile is THIN (fewer than 3 strengths or fewer than 8 traits in total) may you check whether an interest is also
   a strength (e.g. "Do friends ever ask you to design things for them?").
 - Otherwise ask only about a real gap (values, dislikes, work style), and prefer null when the profile is already rich.
 Never ask the same question twice (see earlierMessages).
JSON only:
{"newTraits":[{"id":"kebab-id","label":"...","type":"strength|interest|value|dislike","source":"the user's own words"}],
 "upgrades":[{"label":"...","newLabel":"... or null"}],
 "reply":"...","followUp":"... or null"}`;

// Step 2: rank using the WHOLE profile, not the latest message.
const RANK_PROMPT = `You rank careers for a student using their WHOLE profile.
Inputs: allTraits (everything learned so far), conversation (all their messages), feedback on careers, candidates.
Rules:
- Treat every trait with equal weight no matter when it was said. The most recent message is NOT more important.
- A career should score high only if it fits SEVERAL traits together. One matching trait alone = at most 60.
- Traits of type "dislike" lower the score of careers that require them.
- Careers marked interested get a small boost; notForMe should rank near the bottom; maybe is neutral.
- Careers whose field is in feedback.notForMeFields go to the very bottom (score under 20).
- Score every candidate 0-100. Use only candidate ids given. Never invent careers.
- Keep each reason under 18 words. Output valid JSON with no trailing commas.
- reason: one short sentence that combines at least TWO of the user's traits, ideally from different messages,
  e.g. "Pretty slides + helping friends with app ideas -> designs tools people enjoy using."
JSON only:
{"ranking":[{"id":"...","score":0,"reason":"...","titleKo":"Korean job title (only when writing in Korean, else omit)"}]}`;

// Step 2b: careers OUTSIDE the user's major that connect to their other sides.
const BEYOND_PROMPT = `You help a student discover careers OUTSIDE their major(s) that they have probably never considered.
From outsideCandidates, pick exactly 3 that fit SEVERAL of the user's traits, especially hobbies, "useless" talents,
and interests unrelated to their majors. Avoid the most obvious picks. Use only candidate ids given.
reason: one short sentence (under 18 words) naming the connecting traits and the surprising angle.
Output valid JSON with no trailing commas:
{"beyond":[{"id":"...","score":0,"reason":"...","titleKo":"Korean job title (only when writing in Korean, else omit)"}]}`;

async function askJSON(system: string, payload: unknown) {
  return generateJSON(system, payload, { temperature: 0.4 });
}

export async function POST(req: Request) {
  try {
    const {
      message,
      traits = [] as Trait[],
      confirmedField = null,
      lang = "en",
      history = [] as string[],
      prevRanking = [] as Rank[],
      feedback = {},
      majors = [] as string[],
      context = null,
    } = await req.json();
    const rule = AI_LANG_RULE[(lang as Lang) in AI_LANG_RULE ? (lang as Lang) : "en"];

    // Inside a confirmed field, keep at least 8 options that weren't marked "not for me".
    let candidates: Career[] = confirmedField ? await fieldPool(confirmedField) : (careers as unknown as Career[]);
    if (confirmedField) {
      const rejected: string[] = (feedback as { notForMe?: string[] }).notForMe ?? [];
      const left = candidates.filter((c) => !rejected.includes(c.id)).length;
      if (left < 8 && (await growPool(confirmedField, 8 - left + 2)) > 0) {
        candidates = await fieldPool(confirmedField);
      }
    }

    // Step 1: extract (if it fails, keep going with no new traits)
    let extracted: {
      newTraits?: Trait[];
      upgrades?: { label: string; newLabel?: string | null }[];
      reply?: string;
      followUp?: string | null;
    } = {};
    try {
      extracted = await askJSON(`${EXTRACT_PROMPT}\n\nLANGUAGE: ${rule}`, {
        newMessage: message,
        contextNote: context,
        currentTraits: traits,
        earlierMessages: history,
      });
    } catch (e) {
      console.error("extract failed:", e);
    }

    const known = new Set((traits as Trait[]).map((t) => t.label.toLowerCase()));
    const newTraits: Trait[] = (extracted.newTraits ?? []).filter(
      (t: Trait) => t?.label && !known.has(t.label.toLowerCase())
    );
    // Interests confirmed as strengths move over before ranking.
    const upgrades = (extracted.upgrades ?? []).filter((u) => u?.label);
    const upgraded = (traits as Trait[]).map((t) => {
      const u = upgrades.find((x) => x.label.toLowerCase() === t.label.toLowerCase());
      return u && t.type === "interest" ? { ...t, type: "strength", label: u.newLabel || t.label } : t;
    });
    const allTraits = [...upgraded, ...newTraits];

    // Step 2 (rank) and 2b (beyond the major) run in parallel
    const majorList: string[] = Array.isArray(majors) ? majors : [];
    const outside = majorList.length
      ? (careers as { id: string; field?: string }[]).filter(
          (c) =>
            !majorList.includes(c.field ?? "") &&
            !((feedback as { notForMeFields?: string[] }).notForMeFields ?? []).includes(c.field ?? "")
        )
      : [];
    const [rankResult, beyondResult] = await Promise.allSettled([
      askJSON(`${RANK_PROMPT}\n\nLANGUAGE: ${rule}`, {
        allTraits,
        conversation: [...history, message],
        feedback,
        candidates,
      }),
      outside.length && allTraits.length
        ? askJSON(`${BEYOND_PROMPT}\n\nLANGUAGE: ${rule}`, {
            majors: majorList,
            allTraits,
            conversation: [...history, message],
            outsideCandidates: outside,
          })
        : Promise.resolve({ beyond: [] }),
    ]);
    let ranked: { ranking?: Rank[] } = { ranking: prevRanking };
    if (rankResult.status === "fulfilled") ranked = rankResult.value;
    else console.error("rank failed, keeping previous ranking:", rankResult.reason);
    const outsideIds = new Set(outside.map((c) => c.id));
    const beyond: Rank[] =
      beyondResult.status === "fulfilled"
        ? (beyondResult.value.beyond ?? []).filter((r: Rank) => outsideIds.has(r.id)).slice(0, 3)
        : [];
    if (beyondResult.status === "rejected") console.error("beyond failed:", beyondResult.reason);

    // Step 3: smooth with previous scores so one message can't flip everything
    const validIds = new Set(candidates.map((c) => c.id));
    const prev = new Map((prevRanking as Rank[]).filter((r) => validIds.has(r.id)).map((r) => [r.id, r.score]));
    const ranking: Rank[] = (ranked.ranking ?? [])
      .filter((r: Rank) => validIds.has(r.id))
      .map((r: Rank) => {
        const old = prev.get(r.id);
        const score = old === undefined || old === r.score ? r.score : Math.round(old * 0.35 + r.score * 0.65);
        return { ...r, score };
      })
      .sort((a: Rank, b: Rank) => b.score - a.score);

    // Gemini sometimes ranks only the top few. Append the rest so the list can always refill.
    const rankedIds = new Set(ranking.map((r) => r.id));
    const floor = ranking.length ? Math.min(...ranking.map((r) => r.score)) : 50;
    for (const c of candidates) {
      if (!rankedIds.has(c.id)) ranking.push({ id: c.id, score: prev.get(c.id) ?? Math.max(1, floor - 5), reason: "" });
    }
    ranking.sort((a, b) => b.score - a.score);

    return Response.json({
      newTraits,
      upgrades,
      ranking,
      beyond,
      pool: confirmedField ? candidates : [],
      reply: extracted.reply ?? "",
      followUp: extracted.followUp ?? null,
    });
  } catch (error) {
    console.error("chat error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
