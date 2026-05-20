import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { signSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: "email already registered" }, { status: 409 });
    }

    const id = randomBytes(16).toString("hex");
    const ingest_token = randomBytes(32).toString("hex");
    const password_hash = await bcrypt.hash(password, 12);

    await pool.query(
      "INSERT INTO users (id, email, password_hash, ingest_token) VALUES ($1, $2, $3, $4)",
      [id, email.toLowerCase(), password_hash, ingest_token]
    );

    const jwt = await signSession({ sub: id, email: email.toLowerCase() });
    await setSessionCookie(jwt);

    return NextResponse.json({ ok: true });
  } finally {
    await pool.end();
  }
}
