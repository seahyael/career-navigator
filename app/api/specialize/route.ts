import { GoogleGenAI } from "@google/genai";
import { AI_LANG_RULE, type Lang } from "../../i18n";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const PROMPT = `A student is interested in one career and wants to get more specific.
Suggest 4 more specific roles or specializations inside it that are real, commonly posted job titles
(for example "UX Designer" -> "Product Designer", "Interaction Designer", "UX Researcher", "Design Systems Designer").
Rank them by fit with the student's traits.
Each: title (the common English job title, used for job search), titleKo (Korean title only when writing in Korean, else omit),
summary (one sentence), skills (3-4 key skills), reason (one short sentence linking to the student's traits).
Valid JSON only, no trailing commas:
{"options":[{"title":"...","titleKo":"...","summary":"...","skills":["..."],"reason":"..."}]}`;

export async function POST(req: Request) {
  try {
    const { career, traits = [], lang = "en" } = await req.json();
    if (!career?.title) return Response.json({ error: "career required" }, { status: 400 });
    const rule = AI_LANG_RULE[(lang as Lang) in AI_LANG_RULE ? (lang as Lang) : "en"];
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: JSON.stringify({ career: { title: career.title, summary: career.summary }, userTraits: traits }),
      config: {
        systemInstruction: `${PROMPT}\n\nLANGUAGE: ${rule} Keep "title" in English.`,
        responseMimeType: "application/json",
        temperature: 0.5,
      },
    });
    const raw = (response.text ?? "").replace(/```json|```/g, "").trim();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1).replace(/,\s*([}\]])/g, "$1"));
    }
    const options = (data.options ?? []).slice(0, 4).map((o: { title: string }) => ({
      ...o,
      id: `spec-${career.id}-${o.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      parentId: career.id,
      field: career.field,
      onetCode: career.onetCode,
    }));
    return Response.json({ options });
  } catch (error) {
    console.error("specialize error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
