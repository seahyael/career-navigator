import { GoogleGenAI } from "@google/genai";
import careers from "../../../data/careers.json";
import subfields from "../../../data/subfields.json";
import { AI_LANG_RULE, type Lang } from "../../i18n";

type Career = { id: string; title: string; onetCode?: string; field?: string; summary: string; skills: string[] };

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// O*NET Web Services v2: API key goes in the X-API-Key header.
// If the base URL ever differs, set ONET_BASE_URL in .env.local.
const ONET_BASE = process.env.ONET_BASE_URL ?? "https://api-v2.onetcenter.org";

function findCareer(id: string, field: string | null): Career | undefined {
  const all = [
    ...(careers as unknown as Career[]),
    ...Object.values(subfields as unknown as Record<string, Career[]>).flat(),
  ];
  const inField = field ? (subfields as unknown as Record<string, Career[]>)[field] ?? [] : [];
  return inField.find((c) => c.id === id) ?? all.find((c) => c.id === id);
}

async function fetchOnet(code: string) {
  const key = process.env.ONET_API_KEY;
  if (!key) return { ok: false as const, reason: "ONET_API_KEY is missing in .env.local" };

  const urls = [`${ONET_BASE}/mnm/careers/${code}/report`, `${ONET_BASE}/mnm/careers/${code}/`];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "X-API-Key": key, Accept: "application/json" },
        next: { revalidate: 86400 },
      });
      if (res.ok) return { ok: true as const, data: await res.json(), url };
      errors.push(`${res.status} at ${url}`);
    } catch (e) {
      errors.push(`${String(e)} at ${url}`);
    }
  }
  return { ok: false as const, reason: errors.join(" | ") };
}

const PROMPT = `You help a student explore ONE career.
Facts about the job (tasks, skills, education, outlook) must come ONLY from the O*NET data given.
If O*NET data is missing, use only the short career summary and keep facts minimal.
Keep observation (what the user said) separate from interpretation.
Never claim the user has a trait they did not state. Do not present this career as "the answer".
Return JSON only:
{
 "overview": "2 plain sentences on what they do",
 "tasks": ["3 short typical tasks"],
 "strengthsMatch": [{"trait": "one of the user's own trait labels", "why": "how it helps in this job"}],
 "gaps": [{"skill": "skill to build", "howToStart": "one concrete first step"}],
 "majors": ["up to 4 related majors"],
 "industries": ["up to 3 industries"],
 "education": "one line or null",
 "outlook": "one line or null",
 "nextSteps": [{"stage": "This week|This semester|This year|After graduation", "action": "specific action"}],
 "experiment": "one small thing to try to test whether this career fits",
 "titleKo": "Korean job title (only when writing in Korean, else omit)"
}
strengthsMatch: up to 3, only traits from the user's list. gaps: up to 3. nextSteps: exactly 4, one per stage.`;

export async function POST(req: Request) {
  try {
    const { careerId, field = null, traits = [], lang = "en" } = await req.json();
    const rule = AI_LANG_RULE[(lang as Lang) in AI_LANG_RULE ? (lang as Lang) : "en"];
    const career = findCareer(careerId, field);
    if (!career) return Response.json({ error: "Unknown career" }, { status: 404 });

    const onet = career.onetCode ? await fetchOnet(career.onetCode) : { ok: false as const, reason: "no O*NET code" };
    if (!onet.ok) console.warn("O*NET fetch failed:", onet.reason);

    const onetText = onet.ok ? JSON.stringify(onet.data).slice(0, 15000) : "null";
    const userPart = JSON.stringify({
      career: { title: career.title, summary: career.summary, skills: career.skills },
      userTraits: traits,
      onetData: onetText,
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: userPart,
      config: { systemInstruction: `${PROMPT}\n\nLANGUAGE: ${rule}`, responseMimeType: "application/json" },
    });
    const text = (response.text ?? "").replace(/```json|```/g, "").trim();
    const explore = JSON.parse(text);

    return Response.json({
      title: career.title,
      code: career.onetCode ?? null,
      onet: onet.ok,
      onetNote: onet.ok ? null : onet.reason,
      sourceUrl: career.onetCode ? `https://www.mynextmove.org/profile/summary/${career.onetCode}` : null,
      ...explore,
    });
  } catch (error) {
    console.error("career error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
