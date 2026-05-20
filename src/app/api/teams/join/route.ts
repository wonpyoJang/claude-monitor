import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { invite_code } = await req.json().catch(() => ({}));
  if (!invite_code || typeof invite_code !== "string") {
    return NextResponse.json({ error: "invite_code required" }, { status: 400 });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const teamResult = await pool.query(
      "SELECT id, name FROM teams WHERE invite_code = $1 AND deleted_at IS NULL LIMIT 1",
      [invite_code.trim()]
    );
    const team = teamResult.rows[0] as { id: string; name: string } | undefined;
    if (!team) {
      return NextResponse.json({ error: "invalid invite code" }, { status: 404 });
    }

    const existing = await pool.query(
      "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2",
      [team.id, session.sub]
    );
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: "already a member", team_id: team.id }, { status: 409 });
    }

    await pool.query(
      "INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)",
      [team.id, session.sub]
    );
    return NextResponse.json({ ok: true, team });
  } finally {
    await pool.end();
  }
}
