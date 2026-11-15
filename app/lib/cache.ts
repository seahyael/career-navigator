// Shared caches (LinkedIn analysis, extra O*NET careers) stored in Neon so they work on serverless hosting.
// Falls back to local JSON files when no database is configured (and reads old file caches once).
import { promises as fs } from "fs";
import path from "path";
import { getSql } from "./db";

const MARKET_FILE = path.join(process.cwd(), "data", "market-cache.json");
const EXTRA_FILE = path.join(process.cwd(), "data", "extra-careers.json");

export type MarketEntry = { fetchedAt: string; postings: unknown[]; analysis?: Record<string, unknown> | null };
type Career = { id: string; title: string; onetCode?: string; field?: string; summary: string; skills: string[] };

let ready: Promise<unknown> | null = null;

// A slow or dropped database connection must never hang a request: give up after 3 seconds and fall back.
function timed<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("database timeout")), ms)),
  ]);
}

function db() {
  const sql = getSql();
  if (!sql) return null;
  ready ??= timed(
    (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS market_cache (
        career_id TEXT PRIMARY KEY,
        fetched_at TIMESTAMPTZ NOT NULL,
        postings JSONB NOT NULL,
        analysis JSONB
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS extra_careers (
        field TEXT PRIMARY KEY,
        careers JSONB NOT NULL
      )`;
    })(),
    5000
  ).catch((e) => {
    ready = null; // try again on the next request instead of staying broken
    throw e;
  });
  return sql;
}

async function readFileJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeFileJson(file: string, data: unknown) {
  try {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  } catch {
    // read-only filesystem (e.g. serverless): ignore
  }
}

export async function getMarket(careerId: string): Promise<MarketEntry | null> {
  const sql = db();
  if (sql) {
    try {
      await timed(ready as Promise<unknown>);
      const rows = await timed<Record<string, unknown>[]>(sql`SELECT fetched_at, postings, analysis FROM market_cache WHERE career_id = ${careerId}`);
      if (rows[0]) {
        return {
          fetchedAt: new Date(rows[0].fetched_at as string).toISOString(),
          postings: rows[0].postings as unknown[],
          analysis: (rows[0].analysis as Record<string, unknown> | null) ?? null,
        };
      }
    } catch (e) {
      console.warn("market cache read failed:", e);
    }
  }
  // old local cache (also used when there is no database)
  const file = await readFileJson<Record<string, MarketEntry>>(MARKET_FILE);
  const hit = file?.[careerId] ?? null;
  if (hit && sql) await setMarket(careerId, hit); // move it into Neon
  return hit;
}

export async function setMarket(careerId: string, entry: MarketEntry) {
  const sql = db();
  if (sql) {
    try {
      await timed(ready as Promise<unknown>);
      await timed(sql`
        INSERT INTO market_cache (career_id, fetched_at, postings, analysis)
        VALUES (${careerId}, ${entry.fetchedAt}, ${JSON.stringify(entry.postings)}::jsonb, ${JSON.stringify(entry.analysis ?? null)}::jsonb)
        ON CONFLICT (career_id) DO UPDATE
          SET fetched_at = EXCLUDED.fetched_at, postings = EXCLUDED.postings, analysis = EXCLUDED.analysis`);
      return;
    } catch (e) {
      console.warn("market cache write failed:", e);
    }
  }
  const file = (await readFileJson<Record<string, MarketEntry>>(MARKET_FILE)) ?? {};
  file[careerId] = entry;
  await writeFileJson(MARKET_FILE, file);
}

export async function getExtras(): Promise<Record<string, Career[]>> {
  const sql = db();
  if (sql) {
    try {
      await timed(ready as Promise<unknown>);
      const rows = await timed<Record<string, unknown>[]>(sql`SELECT field, careers FROM extra_careers`);
      if (rows.length) return Object.fromEntries(rows.map((r) => [r.field as string, r.careers as Career[]]));
    } catch (e) {
      console.warn("extra careers read failed:", e);
    }
  }
  return (await readFileJson<Record<string, Career[]>>(EXTRA_FILE)) ?? {};
}

export async function setExtras(field: string, careers: Career[]) {
  const sql = db();
  if (sql) {
    try {
      await timed(ready as Promise<unknown>);
      await timed(sql`
        INSERT INTO extra_careers (field, careers) VALUES (${field}, ${JSON.stringify(careers)}::jsonb)
        ON CONFLICT (field) DO UPDATE SET careers = EXCLUDED.careers`);
      return;
    } catch (e) {
      console.warn("extra careers write failed:", e);
    }
  }
  const file = (await readFileJson<Record<string, Career[]>>(EXTRA_FILE)) ?? {};
  file[field] = careers;
  await writeFileJson(EXTRA_FILE, file);
}

/** For prompts: keep the profile small as it grows. Strengths, values and dislikes first, then the newest interests. */
export function trimTraits<T extends { type: string }>(traits: T[], max = 60): T[] {
  if (traits.length <= max) return traits;
  const core = traits.filter((t) => t.type !== "interest");
  const interests = traits.filter((t) => t.type === "interest");
  const room = Math.max(10, max - core.length);
  return [...core.slice(-max), ...interests.slice(-room)].slice(-max);
}
