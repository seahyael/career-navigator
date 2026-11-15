// Server-only: one Gemini call picks and ranks careers from the full O*NET list for a profile.
// Every code is checked against the O*NET API, so only real occupations are returned.
import { fetchOnet } from "./onet";
import { generateJSON } from "./gemini";
import { getExtras, setExtras, trimTraits } from "./cache";
import type { Career } from "./pool";

const VERIFIED_KEY = "__onet"; // every verified occupation, shared by all users

const PROMPT = `You pick careers for one student from the FULL O*NET-SOC occupation list (about 900 occupations).
Use ONLY their profile: traits (strengths, interests, values, dislikes), background (majors, school status), and feedback.
Pick the HOW_MANY occupations that fit SEVERAL of their traits together, best first. Include a few surprising ones they have
probably never heard of (niche, hands-on, food, crafts, trades, health, outdoors, arts, science, business, anything).
Careers where their major is a real asset get a moderate boost, but never drop a career just because it is outside their major.
Avoid careers that clash with their dislikes. Never include anything in notInterested. Careers in added may be included again.
code: a real O*NET-SOC code like "11-9051.00". title: its official O*NET title.
field: a broad career area in English, 1-3 words (e.g. "Food & Hospitality", "Healthcare", "Computer Science").
score: 0-100 fit. reason: one sentence under 18 words that names at least TWO of their traits.
summary: one plain sentence on what they do. skills: 3 short items.
Output valid JSON with no trailing commas:
{"careers":[{"code":"...","title":"...","field":"...","score":0,"reason":"...","summary":"...","skills":["...","...","..."]}]}`;

type Proposal = {
  code?: string;
  title?: string;
  field?: string;
  score?: number;
  reason?: string;
  summary?: string;
  skills?: string[];
};
export type Found = Career & { score: number; reason: string };

function normalizeCode(raw?: string) {
  const m = String(raw ?? "").trim().match(/^(\d{2}-\d{4})(\.\d{2})?$/);
  return m ? `${m[1]}${m[2] ?? ".00"}` : null;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

function onetTitle(data: unknown): string | null {
  type Node = { title?: unknown; career?: { title?: unknown }; occupation?: { title?: unknown } };
  const d = data as Node | null;
  const t = d?.title ?? d?.career?.title ?? d?.occupation?.title;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

export async function findCareers(opts: {
  traits: { label: string; type: string }[];
  background: unknown;
  notInterested: string[];
  added: string[];
  howMany?: number;
}): Promise<Found[]> {
  const howMany = opts.howMany ?? 15;
  const out = await generateJSON(
    PROMPT.replace("HOW_MANY", String(howMany + 3)), // a few extra in case some codes fail the check
    {
      traits: trimTraits(opts.traits),
      background: opts.background,
      notInterested: opts.notInterested.slice(0, 80),
      added: opts.added.slice(0, 20),
    },
    { temperature: 0.5 }
  );
  const proposals: Proposal[] = Array.isArray(out?.careers) ? out.careers : [];

  const extras = await getExtras();
  const verified: Career[] = extras[VERIFIED_KEY] ?? [];
  const byCode = new Map(verified.map((c) => [c.onetCode, c]));
  const seen = new Set<string>();
  const fresh: Career[] = [];
  const hasKey = !!process.env.ONET_API_KEY;

  const checked = await Promise.all(
    proposals.map(async (p): Promise<Found | null> => {
      const code = normalizeCode(p.code);
      if (!code || seen.has(code)) return null;
      seen.add(code);
      const score = Math.max(0, Math.min(100, Math.round(Number(p.score) || 50)));
      const reason = String(p.reason ?? "").trim();
      const known = byCode.get(code);
      if (known) return { ...known, score, reason };
      if (!hasKey) return null;
      const res = await withTimeout<Awaited<ReturnType<typeof fetchOnet>>>(fetchOnet(code), 4000, {
        ok: false as const,
        reason: "timeout",
      });
      if (!res.ok) return null; // not a real O*NET code (or O*NET unreachable): drop it
      const career: Career = {
        id: `onet-${code}`,
        title: onetTitle(res.data) ?? p.title ?? code,
        onetCode: code,
        field: p.field?.trim() || "Other",
        summary: p.summary?.trim() || `${p.title ?? code} (O*NET ${code})`,
        skills: Array.isArray(p.skills) ? p.skills.slice(0, 3).map(String) : [],
      };
      fresh.push(career);
      return { ...career, score, reason };
    })
  );

  if (fresh.length) {
    try {
      await setExtras(VERIFIED_KEY, [...verified, ...fresh].slice(-800));
    } catch (e) {
      console.warn("saving verified careers failed:", e);
    }
  }
  return checked
    .filter((c): c is Found => !!c)
    .sort((a, b) => b.score - a.score)
    .slice(0, howMany);
}
