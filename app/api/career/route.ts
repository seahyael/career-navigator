import { findAnyCareer, type Career } from "../../lib/pool";
import { fetchOnet } from "../../lib/onet";

// Career detail: O*NET data only, no AI. Read defensively because the report's exact shape can vary.

type Json = unknown;

/** First value found for any of the keys, searching the whole object breadth-first. */
function findKey(obj: Json, keys: string[]): Json {
  const queue: Json[] = [obj];
  let steps = 0;
  while (queue.length && steps++ < 5000) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      queue.push(...cur);
      continue;
    }
    for (const [k, v] of Object.entries(cur as Record<string, Json>)) {
      if (keys.includes(k) && v != null) return v;
      if (v && typeof v === "object") queue.push(v);
    }
  }
  return undefined;
}

const SKIP = new Set(["href", "code", "id", "url", "link", "start", "end", "total", "important"]);
/** Plain text leaves under a node (no links or codes). */
function texts(node: Json, limit: number): string[] {
  const out: string[] = [];
  const walk = (v: Json, key = "") => {
    if (out.length >= limit || v == null || SKIP.has(key)) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s && !/^https?:\/\//.test(s) && !/^\d{2}-\d{4}/.test(s) && !out.includes(s)) out.push(s);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
    if (typeof v === "object") Object.entries(v as Record<string, Json>).forEach(([k, x]) => walk(x, k));
  };
  walk(node);
  return out;
}

export async function POST(req: Request) {
  try {
    const { careerId, field = null, fallback = null } = await req.json();
    // Careers not in our lists (e.g. specializations from the roadmap) come from the client.
    const career: Career | undefined = (await findAnyCareer(careerId, field)) ?? (fallback?.title ? fallback : undefined);
    if (!career) return Response.json({ error: "Unknown career" }, { status: 404 });

    const onet = career.onetCode ? await fetchOnet(career.onetCode) : { ok: false as const, reason: "no O*NET code" };
    if (!onet.ok) console.warn("O*NET fetch failed:", onet.reason);
    const d = onet.ok ? onet.data : null;

    const overview = d ? texts(findKey(d, ["what_they_do", "description"]), 1)[0] : undefined;
    const tasks = d ? texts(findKey(d, ["on_the_job", "tasks", "task"]), 5) : [];
    const skills = d ? texts(findKey(d, ["skills"]), 8).filter((s) => s.length < 60) : [];
    const education = d ? texts(findKey(d, ["education_usually_needed", "education"]), 2).join(" · ") : "";
    const outlookNode = d ? findKey(d, ["job_outlook", "outlook"]) : undefined;
    const outlook = outlookNode ? texts(findKey(outlookNode, ["description", "category"]) ?? outlookNode, 1)[0] : undefined;

    return Response.json({
      title: career.title,
      code: career.onetCode ?? null,
      onet: onet.ok,
      onetNote: onet.ok ? null : onet.reason,
      sourceUrl: career.onetCode ? `https://www.mynextmove.org/profile/summary/${career.onetCode}` : null,
      overview: overview || career.summary,
      tasks,
      skills: skills.length ? skills : career.skills,
      education: education || null,
      outlook: outlook || null,
    });
  } catch (error) {
    console.error("career error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
