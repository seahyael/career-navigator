// O*NET Web Services v2: API key in the X-API-Key header. Set ONET_BASE_URL to override the host.
const ONET_BASE = process.env.ONET_BASE_URL ?? "https://api-v2.onetcenter.org";

export async function fetchOnet(code: string) {
  const key = process.env.ONET_API_KEY;
  if (!key) return { ok: false as const, reason: "ONET_API_KEY is missing in .env.local" };

  const urls = [`${ONET_BASE}/mnm/careers/${code}/report`, `${ONET_BASE}/mnm/careers/${code}/`];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "X-API-Key": key, Accept: "application/json" },
        next: { revalidate: 86400 },
      });
      if (res.ok) return { ok: true as const, data: await res.json(), url };
      errors.push(`${res.status} at ${url}`);
    } catch (e) {
      errors.push(`${String(e)} at ${url}`);
    }
  }
  return { ok: false as const, reason: errors.join(" | ") };
}
