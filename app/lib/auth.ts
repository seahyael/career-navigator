// Minimal username/password auth on Neon. Passwords are hashed with scrypt; sessions live in a cookie.
import { cookies } from "next/headers";
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "crypto";
import { getSql } from "./db";

export const SESSION_COOKIE = "cn_session";
let ready: Promise<unknown> | null = null;

export function authDb() {
  const sql = getSql();
  if (!sql) return null;
  ready ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
  })();
  return { sql, ready };
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newUserId() {
  return randomUUID();
}

export async function createSession(userId: string) {
  const db = authDb();
  if (!db) throw new Error("Database is not configured");
  await db.ready;
  const token = randomBytes(32).toString("hex");
  await db.sql`INSERT INTO sessions (token, user_id) VALUES (${token}, ${userId})`;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function currentUser(): Promise<{ id: string; username: string } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = authDb();
  if (!db) return null;
  try {
    await db.ready;
    const rows = await db.sql`
      SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ${token}`;
    return rows[0] ? { id: rows[0].id as string, username: rows[0].username as string } : null;
  } catch (e) {
    console.error("currentUser error:", e);
    return null;
  }
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  const db = authDb();
  if (token && db) {
    try {
      await db.ready;
      await db.sql`DELETE FROM sessions WHERE token = ${token}`;
    } catch (e) {
      console.error("endSession error:", e);
    }
  }
}
