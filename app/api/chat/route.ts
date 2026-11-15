import { GoogleGenAI } from "@google/genai";
import careers from "../../../data/careers.json";
import { fieldPool, growPool, type Career } from "../../lib/pool";
import { AI_LANG_RULE, type Lang } from "../../i18n";

type Trait = { id: string; label: string; type: string; source: string };
type Rank = { id: string; score: number; reason: string; titleKo?: string };

const MODEL = "gemini-3.5-flash-lite";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Step 1: read only the new message, extract traits, react.
const EXTRACT_PROMPT = `You are a warm career coach for students who feel lost.
The user talks casually. From the NEW message only, extract 0-3 traits.
Types: strength (good at), interest (enjoys), value (cares about), dislike (avoids).
Read between the lines: "lost track of time helping a friend" -> strength: empathy, interest: helping people.
"Useless" talents count. Never mock them; find how they transfer to work.
Do not repeat traits already in currentTraits.
reply: 1-2 friendly sentences reacting to what they said, connecting it to something they said earlier when possible.
followUp: if the profile has fewer than 6 traits or an obvious gap (e.g. no values, no dislikes), ask ONE light question about the gap; else null.
JSON only:
{"newTraits":[{"id":"kebab-id","label":"...","type":"strength|interest|value|dislike","source":"the user's own words"}],
 "reply":"...","followUp":"... or null"}`;

// Step 2: rank using the WHOLE profile, not the latest message.
const RANK_PROMPT = `You rank careers for a student using their WHOLE profile.
Inputs: allTraits (everything learned so far), conversation (all their messages), feedback on careers, candidates.
Rules:
- Treat every trait with equal weight no matter when it was said. The most recent message is NOT more important.
- A career should score high only if it fits SEVERAL traits together. One matching trait alone = at most 60.
- Traits of type "dislike" lower the score of careers that require them.
- Careers marked interested get a small boost; notForMe should rank near the bottom; maybe is neutral.
- Score every candidate 0-100. Use only candidate ids given. Never invent careers.
- Keep each reason under 18 words. Output valid JSON with no trailing commas.
- reason: one short sentence that combines at least TWO of the user's traits, ideally from different messages,
  e.g. "Pretty slides + helping friends with app ideas -> designs tools people enjoy using."
JSON only:
{"ranking":[{"id":"...","score":0,"reason":"...","titleKo":"Korean job title (only when writing in Korean, else omit)"}]}`;

// Gemini sometimes returns slightly broken JSON (trailing commas, cut-off output).
// Try to repair it, and retry once before giving up.
function parseLoose(raw: string) {
  const text = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const sliced = start >= 0 && end > start ? text.slice(start, end + 1) : text;
    return JSON.parse(sliced.replace(/,\s*([}\]])/g, "$1"));
  }
}

// Step 2b: careers OUTSIDE the user's major that connect to their other sides.
const BEYOND_PROMPT = `You help a student discover careers OUTSIDE their major(s) that they have probably never considered.
From outsideCandidates, pick exactly 3 that fit SEVERAL of the user's traits, especially hobbies, "useless" talents,
and interests unrelated to their majors. Avoid the most obvious picks. Use only candidate ids given.
reason: one short sentence (under 18 words) naming the connecting traits and the surprising angle.
Output valid JSON with no trailing commas:
{"beyond":[{"id":"...","score":0,"reason":"...","titleKo":"Korean job title (only when writing in Korean, else omit)"}]}`;

async function askJSON(system: string, payload: unknown) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: JSON.stringify(payload),
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          temperature: 0.4,
          maxOutputTokens: 8192,
        },
      });
      return parseLoose(response.text ?? "");
    } catch (e) {
      lastError = e;
      console.warn(`Gemini JSON attempt ${attempt + 1} failed:`, String(e).slice(0, 200));
    }
  }
  throw lastError;
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
    let extracted: { newTraits?: Trait[]; reply?: string; followUp?: string | null } = {};
    try {
      extracted = await askJSON(`${EXTRACT_PROMPT}\n\nLANGUAGE: ${rule}`, {
        newMessage: message,
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
    const allTraits = [...traits, ...newTraits];

    // Step 2 (rank) and 2b (beyond the major) run in parallel
    const majorList: string[] = Array.isArray(majors) ? majors : [];
    const outside = majorList.length
      ? (careers as { id: string; field?: string }[]).filter((c) => !majorList.includes(c.field ?? ""))
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

    return Response.json({
      newTraits,
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
