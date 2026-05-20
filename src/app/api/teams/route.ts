import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { randomBytes } from "crypto";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.invite_code, t.created_at,
              (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count,
              t.created_by = $1 AS is_owner
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = $1 AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC`,
      [session.sub]
    );
    return NextResponse.json({ teams: result.rows });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { name } = await req.json().catch(() => ({}));
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const invite_code = randomBytes(6).toString("hex");
    const result = await pool.query(
      `INSERT INTO teams (name, invite_code, created_by) VALUES ($1, $2, $3) RETURNING id, name, invite_code`,
      [name.trim(), invite_code, session.sub]
    );
    const team = result.rows[0] as { id: string; name: string; invite_code: string };
    await pool.query(
      `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [team.id, session.sub]
    );
    return NextResponse.json({ team });
  } finally {
    await pool.end();
  }
}
