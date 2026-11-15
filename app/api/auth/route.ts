import { authDb, createSession, currentUser, endSession, hashPassword, newUserId, verifyPassword } from "../../lib/auth";

// GET: who is logged in
export async function GET() {
  const user = await currentUser();
  return Response.json({ user, available: !!authDb() });
}

// POST: { action: "signup" | "login" | "logout", username?, password? }
export async function POST(req: Request) {
  try {
    const { action, username = "", password = "" } = await req.json();

    if (action === "logout") {
      await endSession();
      return Response.json({ ok: true });
    }

    const db = authDb();
    if (!db) return Response.json({ error: "db" }, { status: 503 });
    await db.ready;

    const name = String(username).trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,30}$/.test(name)) return Response.json({ error: "username" }, { status: 400 });
    if (String(password).length < 6) return Response.json({ error: "password" }, { status: 400 });

    if (action === "signup") {
      const taken = await db.sql`SELECT 1 FROM users WHERE username = ${name}`;
      if (taken.length) return Response.json({ error: "taken" }, { status: 409 });
      const id = newUserId();
      await db.sql`INSERT INTO users (id, username, password_hash) VALUES (${id}, ${name}, ${hashPassword(password)})`;
      await createSession(id);
      return Response.json({ user: { id, username: name }, isNew: true });
    }

    if (action === "login") {
      const rows = await db.sql`SELECT id, password_hash FROM users WHERE username = ${name}`;
      if (!rows[0] || !verifyPassword(password, rows[0].password_hash as string)) {
        return Response.json({ error: "wrong" }, { status: 401 });
      }
      await createSession(rows[0].id as string);
      return Response.json({ user: { id: rows[0].id, username: name }, isNew: false });
    }

    return Response.json({ error: "action" }, { status: 400 });
  } catch (e) {
    console.error("auth error:", e);
    return Response.json({ error: "server" }, { status: 500 });
  }
}
