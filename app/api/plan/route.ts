import { GoogleGenAI } from "@google/genai";
import { promises as fs } from "fs";
import path from "path";
import { AI_LANG_RULE, type Lang } from "../../i18n";

async function marketEvidence(ids: string[]) {
  try {
    const cache = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "market-cache.json"), "utf8"));
    const out: Record<string, unknown> = {};
    for (const id of ids) {
      const a = cache[id]?.analysis;
      if (a) {
        out[id] = {
          postingsCount: a.postingsCount,
          skills: (a.skills ?? []).map((s: { name: string; count: number }) => ({ name: s.name, count: s.count })),
          certifications: a.certifications ?? [],
          degrees: a.degrees ?? [],
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const PROMPT = `You create a concrete action plan for a college student exploring careers.
Inputs: interestedCareers (with id, title, summary, skills), userTraits, majors, completedTasks (with how they felt).
Create 10-14 tasks.
- period: "week" (this week), "semester" (this semester), or "year" (this year).
- scope: "common" if the task helps EVERY interested career, otherwise the career id it belongs to.
  Include at least 3 common tasks.
- label:
  "required" = needed to enter that career even if the student may not enjoy it (degree, core skill, portfolio, license).
     Only mark required when the career's own summary/skills justify it. Never drop a required task because of feelings.
  "recommended" = fits the student's traits and helps the career.
  "explore" = a light way to test whether the career fits (watch a day-in-the-life video, talk to someone, try a mini project).
- text: specific and doable (under 14 words). why: one short sentence.
- marketEvidence (keyed by career id) holds counts from real LinkedIn postings. When a career has it,
  base its required and recommended skill/certification tasks on the MOST frequent items there and set
  evidence to the count, e.g. "11/15 postings". Never use postings to judge whether the career fits; only to decide what to build.
  If there is no evidence for a task, set evidence to null.
- Do not repeat completed tasks. If the student felt bad about a kind of task, offer a gentler alternative,
  but keep required tasks and say why they matter.
Valid JSON only, no trailing commas:
{"tasks":[{"id":"kebab-id","text":"...","period":"week|semester|year","scope":"common|<career id>","label":"required|recommended|explore","why":"...","evidence":"11/15 postings or null"}]}`;

export async function POST(req: Request) {
  try {
    const { interestedCareers = [], traits = [], majors = [], completedTasks = [], lang = "en" } = await req.json();
    const evidence = await marketEvidence((interestedCareers as { id: string }[]).map((c) => c.id));
    const rule = AI_LANG_RULE[(lang as Lang) in AI_LANG_RULE ? (lang as Lang) : "en"];

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash-lite",
          contents: JSON.stringify({ interestedCareers, userTraits: traits, majors, completedTasks, marketEvidence: evidence }),
          config: {
            systemInstruction: `${PROMPT}\n\nLANGUAGE: ${rule} Keep period, scope and label values in English exactly as specified.`,
            responseMimeType: "application/json",
            temperature: 0.5,
            maxOutputTokens: 8192,
          },
        });
        const raw = (response.text ?? "").replace(/```json|```/g, "").trim();
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1).replace(/,\s*([}\]])/g, "$1"));
        }
        const ids = new Set((interestedCareers as { id: string }[]).map((c) => c.id));
        const tasks = (data.tasks ?? []).filter(
          (t: { scope: string; period: string; label: string }) =>
            (t.scope === "common" || ids.has(t.scope)) &&
            ["week", "semester", "year"].includes(t.period) &&
            ["required", "recommended", "explore"].includes(t.label)
        );
        return Response.json({ tasks, evidenceFor: Object.keys(evidence) });
      } catch (e) {
        lastError = e;
        console.warn(`plan attempt ${attempt + 1} failed:`, String(e).slice(0, 200));
      }
    }
    throw lastError;
  } catch (error) {
    console.error("plan error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
