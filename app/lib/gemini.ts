// Shared Gemini JSON call: retries when the model is busy (503/429) or returns slightly broken JSON.
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
export const MODEL = "gemini-3.5-flash-lite";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parseLoose(raw: string) {
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

function isBusy(e: unknown) {
  const s = String(e);
  return s.includes("503") || s.includes("UNAVAILABLE") || s.includes("429") || s.includes("RESOURCE_EXHAUSTED");
}

export async function generateJSON(
  system: string,
  payload: unknown,
  opts: { temperature?: number; maxOutputTokens?: number; attempts?: number } = {}
) {
  const attempts = opts.attempts ?? 4;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: typeof payload === "string" ? payload : JSON.stringify(payload),
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          temperature: opts.temperature ?? 0.4,
          maxOutputTokens: opts.maxOutputTokens ?? 8192,
        },
      });
      return parseLoose(response.text ?? "");
    } catch (e) {
      lastError = e;
      const busy = isBusy(e);
      console.warn(`Gemini attempt ${i + 1}/${attempts} failed${busy ? " (model busy)" : ""}:`, String(e).slice(0, 160));
      if (i < attempts - 1) await sleep(busy ? 1500 * (i + 1) : 300);
    }
  }
  throw lastError;
}
