import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(
      "SELECT ingest_token, display_name, avatar_emoji FROM users WHERE id = $1",
      [session.sub]
    );
    const row = result.rows[0] as { ingest_token: string; display_name: string | null; avatar_emoji: string | null } | undefined;
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      ingest_token: row.ingest_token,
      monitor_url: process.env.NEXT_PUBLIC_APP_URL ?? "",
      display_name: row.display_name ?? "",
      avatar_emoji: row.avatar_emoji ?? "🧑‍💻",
    });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { display_name, avatar_emoji } = body as { display_name?: string; avatar_emoji?: string };

  if (display_name !== undefined) {
    const trimmed = display_name.trim();
    if (trimmed.length > 20) {
      return NextResponse.json({ error: "닉네임은 20자 이하" }, { status: 400 });
    }
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `UPDATE users SET
        display_name = COALESCE($1, display_name),
        avatar_emoji = COALESCE($2, avatar_emoji)
       WHERE id = $3`,
      [
        display_name !== undefined ? (display_name.trim() || null) : null,
        avatar_emoji !== undefined ? avatar_emoji : null,
        session.sub,
      ]
    );
    return NextResponse.json({ ok: true });
  } finally {
    await pool.end();
  }
}
