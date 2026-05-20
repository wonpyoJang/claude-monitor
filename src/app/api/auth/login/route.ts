import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { signSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1",
      [email.toLowerCase()]
    );
    const user = result.rows[0] as { id: string; email: string; password_hash: string } | undefined;
    if (!user) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }

    const jwt = await signSession({ sub: user.id, email: user.email });
    await setSessionCookie(jwt);

    return NextResponse.json({ ok: true });
  } finally {
    await pool.end();
  }
}
