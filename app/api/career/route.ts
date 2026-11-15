import { findAnyCareer, type Career } from "../../lib/pool";
import { fetchOnet } from "../../lib/onet";
import { generateJSON } from "../../lib/gemini";
import { AI_LANG_RULE, type Lang } from "../../i18n";



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
    const { careerId, field = null, traits = [], lang = "en", fallback = null } = await req.json();
    const rule = AI_LANG_RULE[(lang as Lang) in AI_LANG_RULE ? (lang as Lang) : "en"];
    // Specializations made in the roadmap are not in our list, so the client sends them along.
    const career: Career | undefined = (await findAnyCareer(careerId, field)) ?? (fallback?.title ? fallback : undefined);
    if (!career) return Response.json({ error: "Unknown career" }, { status: 404 });

    const onet = career.onetCode ? await fetchOnet(career.onetCode) : { ok: false as const, reason: "no O*NET code" };
    if (!onet.ok) console.warn("O*NET fetch failed:", onet.reason);

    const onetText = onet.ok ? JSON.stringify(onet.data).slice(0, 15000) : "null";
    const userPart = JSON.stringify({
      career: { title: career.title, summary: career.summary, skills: career.skills },
      userTraits: traits,
      onetData: onetText,
    });

    const explore = await generateJSON(`${PROMPT}\n\nLANGUAGE: ${rule}`, userPart);

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
