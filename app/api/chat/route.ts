import { GoogleGenAI } from "@google/genai";
import careers from "../../../data/careers.json";
import subfields from "../../../data/subfields.json";

const SYSTEM_PROMPT = `You are a warm career coach for students who feel lost.
The user talks casually. From the NEW message only, extract 0-3 traits.
Types: strength (good at), interest (enjoys), value (cares about), dislike (avoids).
Read between the lines: "lost track of time helping a friend" -> strength: empathy, interest: helping people.
"Useless" talents count. Never mock them; find how they transfer to work.
Then rank ALL candidates by fit with ALL traits (old + new). Score 0-100.
Use only candidate ids given. Never invent careers.
Each reason: one short sentence that names the user's own traits, e.g. "Loves pretty slides + enjoys coding -> builds polished interfaces."
reply: 1-2 friendly sentences reacting to what they said.
followUp: if traits are fewer than 6 or unclear, ask ONE light question; else null.
Respond with JSON only in this shape:
{"newTraits":[{"id":"...","label":"...","type":"strength|interest|value|dislike","source":"the user's words"}],
 "ranking":[{"id":"...","score":0,"reason":"..."}],
 "reply":"...","followUp":"... or null"}`;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: Request) {
  try {
    const { message, traits = [], confirmedField = null } = await req.json();

    const candidates = confirmedField
      ? (subfields as Record<string, unknown[]>)[confirmedField] ?? []
      : careers;

    const userPart = JSON.stringify({ message, currentTraits: traits, candidates });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: userPart,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
      },
    });

    let text = response.text ?? "";
    text = text.replace(/```json|```/g, "").trim();
    const data = JSON.parse(text);

    return Response.json(data);
  } catch (error) {
    console.error("chat error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}