import { getSql } from "../../lib/db";
import { currentUser } from "../../lib/auth";

// Logged-in users are stored under their account; guests under their browser id.
async function identity(guestId: string | null) {
  const user = await currentUser();
  return user ? `user:${user.id}` : guestId;
}

// One row per user: the whole app state as JSON. Simple and enough for a hackathon.
let ready: Promise<unknown> | null = null;

function db() {
  const sql = getSql();
  if (!sql) return null;
  ready ??= sql`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  return sql;
}

export async function GET(req: Request) {
  const userId = await identity(new URL(req.url).searchParams.get("userId"));
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
  const sql = db();
  if (!sql) return Response.json({ data: null, storage: "none" });
  try {
    await ready;
    const rows = await sql`SELECT data, updated_at FROM profiles WHERE user_id = ${userId}`;
    return Response.json({ data: rows[0]?.data ?? null, updatedAt: rows[0]?.updated_at ?? null, storage: "neon" });
  } catch (e) {
    console.error("profile GET error:", e);
    return Response.json({ data: null, storage: "error", error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = await identity(body.userId ?? null);
    const data = body.data;
    if (!userId || !data) return Response.json({ error: "userId and data required" }, { status: 400 });
    const sql = db();
    if (!sql) return Response.json({ ok: false, storage: "none" });
    await ready;
    await sql`
      INSERT INTO profiles (user_id, data, updated_at)
      VALUES (${userId}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    return Response.json({ ok: true, storage: "neon" });
  } catch (e) {
    console.error("profile POST error:", e);
    return Response.json({ ok: false, storage: "error", error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const userId = await identity(new URL(req.url).searchParams.get("userId"));
  const sql = userId ? db() : null;
  if (!userId || !sql) return Response.json({ ok: false });
  try {
    await ready;
    await sql`DELETE FROM profiles WHERE user_id = ${userId}`;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("profile DELETE error:", e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
