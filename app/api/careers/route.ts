import { findCareers, type Found } from "../../lib/findCareers";
import { fallbackCareers } from "../../lib/fallback";

export const maxDuration = 60;

// "Find careers" button: rank 15 careers from the full O*NET list using only the About me profile.
export async function POST(req: Request) {
  try {
    const { traits = [], majors = [], timeline = {}, notInterested = [], added = [] } = await req.json();
    if (!Array.isArray(traits) || !traits.length) {
      return Response.json({ error: "Tell the coach a little about yourself first." }, { status: 400 });
    }
    let careers: Found[] = [];
    try {
      careers = await findCareers({
        traits,
        background: { majors, ...timeline },
        notInterested,
        added,
      });
    } catch (e) {
      console.warn("careers: Gemini failed, using no-AI fallback:", String(e).slice(0, 120));
    }
    // Gemini out of quota or too slow: rank real O*NET-coded careers by matching the user's own words.
    if (!careers.length) careers = fallbackCareers({ traits, majors, notInterested });
    if (!careers.length) return Response.json({ error: "No careers found right now. Please try again." }, { status: 502 });
    return Response.json({ careers });
  } catch (error) {
    console.error("careers error:", error);
    const busy = /429|RESOURCE_EXHAUSTED/.test(String(error));
    return Response.json({ error: busy ? "quota" : String(error) }, { status: busy ? 429 : 500 });
  }
}
