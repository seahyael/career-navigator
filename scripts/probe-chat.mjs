import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "fs";

const env = readFileSync(".env.local", "utf8");
const apiKey = env.match(/GEMINI_API_KEY=(.*)/)[1].trim();
const careers = JSON.parse(readFileSync("data/careers.json", "utf8"));
const source = readFileSync("app/api/chat/route.ts", "utf8");
const systemInstruction = source.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];
const ai = new GoogleGenAI({ apiKey });
const response = await ai.models.generateContent({
  model: "gemini-3.5-flash-lite",
  contents: JSON.stringify({
    message:
      "I lose track of time helping friends debug their code, and I care about making things look clear.",
    traits: [],
    candidates: careers,
  }),
  config: {
    systemInstruction,
    responseMimeType: "application/json",
  },
});
const text = response.text ?? "";
console.log("LEN", text.length);
const parsed = JSON.parse(text);
console.log("keys", Object.keys(parsed));
console.log("newTraits", JSON.stringify(parsed.newTraits, null, 2));
console.log("followUp", JSON.stringify(parsed.followUp));
console.log("ranking", parsed.ranking?.length);
const bad = (parsed.ranking ?? []).filter(
  (item) =>
    typeof item.id !== "string" ||
    typeof item.score !== "number" ||
    typeof item.reason !== "string",
);
console.log("bad", bad.length, JSON.stringify(bad.slice(0, 2)));
console.log(
  "score types",
  [...new Set((parsed.ranking ?? []).map((item) => typeof item.score))].join(","),
);
