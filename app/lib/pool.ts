// Server-only helpers for the career candidate pool.
import { getExtras, setExtras } from "./cache";
import careersData from "../../data/careers.json";
import subfieldsData from "../../data/subfields.json";

export type Career = { id: string; title: string; onetCode?: string; field?: string; summary: string; skills: string[] };

const careers = careersData as unknown as Career[];
const subfields = subfieldsData as unknown as Record<string, Career[]>;
const ONET_BASE = process.env.ONET_BASE_URL ?? "https://api-v2.onetcenter.org";

// Search words used to find more real O*NET occupations inside each field.
const FIELD_QUERIES: Record<string, string[]> = {
  "Computer Science": ["software", "computer", "developer"],
  Design: ["designer", "artist", "design"],
  Business: ["business", "marketing", "manager"],
  Psychology: ["psychologist", "counselor", "therapist"],
  Communications: ["writer", "communications", "media"],
  Science: ["scientist", "research", "laboratory"],
  Education: ["teacher", "instructor", "education"],
};

export const readExtras = getExtras;

export function dedupe(list: Career[]) {
  const ids = new Set<string>();
  const codes = new Set<string>();
  return list.filter((c) => {
    if (ids.has(c.id) || (c.onetCode && codes.has(c.onetCode))) return false;
    ids.add(c.id);
    if (c.onetCode) codes.add(c.onetCode);
    return true;
  });
}

/** Every candidate inside one field: hand-picked sub-fields, then same-field careers, then O*NET extras. */
export async function fieldPool(field: string): Promise<Career[]> {
  const extras = await readExtras();
  return dedupe([
    ...(subfields[field] ?? []),
    ...careers.filter((c) => c.field === field),
    ...(extras[field] ?? []),
    ...(extras.__onet ?? []).filter((c) => c.field === field),
  ]);
}

export async function findAnyCareer(id: string, field: string | null): Promise<Career | undefined> {
  if (field) {
    const hit = (await fieldPool(field)).find((c) => c.id === id);
    if (hit) return hit;
  }
  const extras = Object.values(await readExtras()).flat();
  return [...careers, ...Object.values(subfields).flat(), ...extras].find((c) => c.id === id);
}

/** Pull more real occupations for a field from O*NET keyword search and remember them. */
export async function growPool(field: string, howMany = 6): Promise<number> {
  const key = process.env.ONET_API_KEY;
  if (!key) return 0;
  const current = await fieldPool(field);
  const knownCodes = new Set(current.map((c) => c.onetCode).filter(Boolean));
  const added: Career[] = [];

  for (const q of FIELD_QUERIES[field] ?? [field]) {
    if (added.length >= howMany) break;
    try {
      const res = await fetch(`${ONET_BASE}/mnm/search?keyword=${encodeURIComponent(q)}&start=1&end=20`, {
        headers: { "X-API-Key": key, Accept: "application/json" },
      });
      if (!res.ok) {
        console.warn(`O*NET search ${res.status} for "${q}"`);
        continue;
      }
      const data = await res.json();
      const found: { code?: string; title?: string }[] = data.career ?? data.occupation ?? data.careers ?? [];
      for (const f of found) {
        if (!f.code || !f.title || knownCodes.has(f.code)) continue;
        knownCodes.add(f.code);
        added.push({
          id: `onet-${f.code}`,
          title: f.title,
          onetCode: f.code,
          field,
          summary: `${f.title} (O*NET ${f.code})`,
          skills: [],
        });
        if (added.length >= howMany) break;
      }
    } catch (e) {
      console.warn("O*NET search failed:", e);
    }
  }

  if (added.length) {
    const extras = await readExtras();
    await setExtras(field, [...(extras[field] ?? []), ...added]);
  }
  return added.length;
}
