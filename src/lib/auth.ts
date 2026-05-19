import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { Pool } from "@neondatabase/serverless";

export type { SessionPayload } from "./session";
export { signSession, verifySession } from "./session";

const COOKIE_NAME = "session";

export async function getSession() {
  const { verifySession } = await import("./session");
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getUserByIngestToken(
  pool: Pool,
  token: string
): Promise<{ id: string; email: string } | null> {
  const rows = await pool.query(
    "SELECT id, email FROM users WHERE ingest_token = $1 LIMIT 1",
    [token]
  );
  return (rows.rows[0] as { id: string; email: string }) ?? null;
}

export function extractBearerToken(req: NextRequest): string {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}
