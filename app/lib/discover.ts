// Server-only: search the whole O*NET occupation list for careers that fit a profile.
// Gemini proposes O*NET-SOC codes; each code is checked against the O*NET API, so only real occupations survive.
import { fetchOnet } from "./onet";
import { generateJSON } from "./gemini";
import { getExtras, setExtras, trimTraits } from "./cache";
import type { Career } from "./pool";

const VERIFIED_KEY = "__onet"; // every verified occupation, shared by all users

const PROMPT = `You search the FULL O*NET-SOC occupation list (about 900 occupations) for careers that fit one student.
Use the student's WHOLE profile: every trait, hobby, part-time job, "useless" talent and dislike in allTraits and conversation.
Propose up to HOW_MANY occupations. Each should fit SEVERAL of their traits together.
Mix clear fits with surprising ones the student has probably never heard of: niche jobs, hands-on work, food, crafts, trades,
health, outdoors, public service, arts, science, business, anything. Do NOT limit yourself to their major.
Skip anything in exclude, and avoid careers that clash with their dislikes.
code: a real O*NET-SOC code like "11-9051.00". title: its official O*NET title.
field: a broad career area in English, 1-3 words (e.g. "Food & Hospitality", "Healthcare", "Skilled Trades", "Computer Science").
summary: one plain sentence on what they do. skills: 3 short items.
Output valid JSON with no trailing commas:
{"careers":[{"code":"...","title":"...","field":"...","summary":"...","skills":["...","...","..."]}]}`;

type Proposal = { code?: string; title?: string; field?: string; summary?: string; skills?: string[] };

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

export async function discoverCareers(opts: {
  traits: { label: string; type: string }[];
  conversation: string[];
  exclude: string[];
  howMany?: number;
  focusField?: string | null;
}): Promise<Career[]> {
  if (!process.env.ONET_API_KEY || (!opts.traits.length && !opts.conversation.some((m) => m?.trim()))) return [];
  const howMany = opts.howMany ?? 10;

  let proposals: Proposal[] = [];
  try {
    const focus = opts.focusField
      ? `\nEvery occupation must belong to the career area "${opts.focusField}" (use it as the field value).`
      : "";
    const out = await generateJSON(PROMPT.replace("HOW_MANY", String(howMany)) + focus, {
      allTraits: trimTraits(opts.traits as { label: string; type: string }[]),
      conversation: opts.conversation.slice(-15),
      exclude: opts.exclude.slice(0, 120),
    }, { temperature: 0.7, attempts: 2 });
    proposals = Array.isArray(out?.careers) ? out.careers : [];
  } catch (e) {
    console.warn("discover failed:", e);
    return [];
  }

  const extras = await getExtras();
  const verified: Career[] = extras[VERIFIED_KEY] ?? [];
  const byCode = new Map(verified.map((c) => [c.onetCode, c]));
  const seen = new Set<string>();
  const fresh: Career[] = [];

  const checked = await Promise.all(
    proposals.slice(0, howMany + 2).map(async (p) => {
      const code = normalizeCode(p.code);
      if (!code || seen.has(code)) return null;
      seen.add(code);
      const known = byCode.get(code);
      if (known) return known;
      const res = await withTimeout<Awaited<ReturnType<typeof fetchOnet>>>(fetchOnet(code), 4000, { ok: false as const, reason: "timeout" });
      if (!res.ok) return null; // not a real O*NET code (or O*NET unreachable): drop it
      const career: Career = {
        id: `onet-${code}`,
        title: onetTitle(res.data) ?? p.title ?? code,
        onetCode: code,
        field: opts.focusField ?? (p.field?.trim() || "Other"),
        summary: p.summary?.trim() || `${p.title ?? code} (O*NET ${code})`,
        skills: Array.isArray(p.skills) ? p.skills.slice(0, 3).map(String) : [],
      };
      fresh.push(career);
      return career;
    })
  );

  if (fresh.length) {
    try {
      await setExtras(VERIFIED_KEY, [...verified, ...fresh].slice(-800));
    } catch (e) {
      console.warn("saving verified careers failed:", e);
    }
  }
  return checked.filter((c): c is Career => !!c);
}
