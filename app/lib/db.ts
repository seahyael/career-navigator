// Neon Postgres client, created lazily so a missing env var never crashes the build or import.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { parseEnv } from "@neon/env";
import config from "../../neon";

let client: NeonQueryFunction<false, false> | null = null;

function databaseUrl(): string | undefined {
  try {
    // Variables pulled by `neon env pull`, read through the project's neon.ts config.
    const env = parseEnv(config) as unknown as { postgres?: { databaseUrl?: string } };
    if (env.postgres?.databaseUrl) return env.postgres.databaseUrl;
  } catch {
    // fall through to the plain env var
  }
  return process.env.DATABASE_URL;
}

/** Returns the Neon SQL client, or null when no database is configured. */
export function getSql() {
  if (client) return client;
  const url = databaseUrl();
  if (!url) return null;
  client = neon(url);
  return client;
}
