import { GoogleGenAI } from "@google/genai";
import { promises as fs } from "fs";
import path from "path";
import { AI_LANG_RULE, type Lang } from "../../i18n";

// Live LinkedIn job postings via Bright Data, used ONLY to show what to build (never to judge fit).
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const BD = "https://api.brightdata.com/datasets/v3";
const DATASET = "gd_lpfll7v5hcqtkxl6l"; // LinkedIn job listings
const CACHE_FILE = path.join(process.cwd(), "data", "market-cache.json");

type Posting = {
  job_title?: string;
  company_name?: string;
  url?: string;
  job_summary?: string;
  job_seniority_level?: string;
  job_base_pay_range?: string;
  base_salary?: { min_amount?: number; max_amount?: number; currency?: string; payment_period?: string };
};

type Entry = { fetchedAt: string; postings: Posting[]; analysis?: unknown };

async function readCache(): Promise<Record<string, Entry>> {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeCache(cache: Record<string, unknown>) {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn("could not write market cache:", e);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPostings(keyword: string): Promise<Posting[]> {
  const key = process.env.BRIGHTDATA_API_KEY;
  if (!key) throw new Error("BRIGHTDATA_API_KEY is missing in .env.local");
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const res = await fetch(
    `${BD}/scrape?dataset_id=${DATASET}&type=discover_new&discover_by=keyword&include_errors=true&format=json&limit_per_input=15`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: [{ keyword, location: "United States", country: "US", time_range: "Past month" }],
      }),
    }
  );
  const body = await res.json();

  // Fast path: the scrape endpoint answered with the postings directly.
  if (Array.isArray(body)) return body;

  // Slow path: it handed back a snapshot id; poll until ready (up to ~90s).
  const snapshotId = body?.snapshot_id;
  if (!snapshotId) throw new Error(`Bright Data: unexpected response ${JSON.stringify(body).slice(0, 200)}`);
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const snap = await fetch(`${BD}/snapshot/${snapshotId}?format=json`, { headers });
    if (snap.status === 200) {
      const data = await snap.json();
      if (Array.isArray(data)) return data;
    }
  }
  throw new Error("Bright Data is still collecting. Try again in a minute.");
}

const PROMPT = `You read real LinkedIn job postings for one career and tell a student what employers ask for right now.
Count how many postings mention each item. Use only what the postings say.
Then compare with the student's traits: have=true only if a trait clearly shows it.
Valid JSON only, no trailing commas:
{"skills":[{"name":"...","count":0,"have":false}],
 "degrees":[{"name":"...","count":0}],
 "certifications":[{"name":"...","count":0}],
 "experience":"one line on typical experience asked for entry roles",
 "focusNow":["the 3 skills the student should start building first, short"]}
skills: top 8 by count.`;

export async function POST(req: Request) {
  try {
    const { careerId, title, traits = [], lang = "en", refresh = false } = await req.json();
    if (!careerId || !title) return Response.json({ error: "careerId and title are required" }, { status: 400 });
    const rule = AI_LANG_RULE[(lang as Lang) in AI_LANG_RULE ? (lang as Lang) : "en"];

    const cache = await readCache();
    let entry = cache[careerId];
    if (!entry || refresh) {
      const postings = await fetchPostings(title);
      entry = { fetchedAt: new Date().toISOString(), postings };
      cache[careerId] = entry;
      await writeCache(cache);
    }

    const postings = entry.postings.filter((p) => p && (p.job_title || p.job_summary));
    if (!postings.length) return Response.json({ error: "No postings found for this career right now." }, { status: 404 });

    const compact = postings.slice(0, 15).map((p) => ({
      title: p.job_title,
      seniority: p.job_seniority_level,
      text: (p.job_summary ?? "").slice(0, 1500),
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: JSON.stringify({ career: title, userTraits: traits, postings: compact }),
      config: {
        systemInstruction: `${PROMPT}\n\nLANGUAGE: ${rule}`,
        responseMimeType: "application/json",
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    });
    const raw = (response.text ?? "").replace(/```json|```/g, "").trim();
    let analysis;
    try {
      analysis = JSON.parse(raw);
    } catch {
      analysis = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1).replace(/,\s*([}\]])/g, "$1"));
    }

    // Save the analysis so the roadmap can use it as evidence.
    cache[careerId] = { ...entry, analysis: { postingsCount: postings.length, ...analysis } };
    await writeCache(cache);

    const salaries = postings
      .map((p) => p.base_salary)
      .filter((s) => s?.min_amount && s?.payment_period?.toLowerCase().startsWith("y")) as {
      min_amount: number;
      max_amount?: number;
    }[];
    const salary = salaries.length
      ? {
          min: Math.min(...salaries.map((s) => s.min_amount)),
          max: Math.max(...salaries.map((s) => s.max_amount ?? s.min_amount)),
          n: salaries.length,
        }
      : null;

    return Response.json({
      postingsCount: postings.length,
      fetchedAt: entry.fetchedAt,
      salary,
      samples: postings.slice(0, 3).map((p) => ({ title: p.job_title, company: p.company_name, url: p.url })),
      ...analysis,
    });
  } catch (error) {
    console.error("market error:", error);
    return Response.json({ error: String(error).replace(/^Error: /, "") }, { status: 500 });
  }
}
