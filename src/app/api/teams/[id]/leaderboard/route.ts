import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["7", "30", "90", "all"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const teamId = parseInt(id, 10);
  if (isNaN(teamId)) return NextResponse.json({ error: "invalid team id" }, { status: 400 });

  const period = req.nextUrl.searchParams.get("period") ?? "30";
  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json({ error: "invalid period" }, { status: 400 });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Verify caller is a member of this team
    const memberCheck = await pool.query(
      "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, session.sub]
    );
    if (memberCheck.rows.length === 0) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const teamResult = await pool.query(
      "SELECT id, name, invite_code FROM teams WHERE id = $1 AND deleted_at IS NULL",
      [teamId]
    );
    const team = teamResult.rows[0];
    if (!team) return NextResponse.json({ error: "not found" }, { status: 404 });

    const periodFilter =
      period === "all"
        ? ""
        : `AND t.ts >= NOW() - INTERVAL '${parseInt(period, 10)} days'`;

    const rows = await pool.query(
      `SELECT
        u.id,
        u.email,
        u.display_name,
        u.avatar_emoji,
        COALESCE(SUM(t.cost_usd), 0) AS total_cost,
        COALESCE(SUM(COALESCE(t.tokens_input,0) + COALESCE(t.tokens_output,0)), 0) AS total_tokens,
        CASE WHEN COUNT(t.id) > 0
          THEN SUM(t.cost_usd) / COUNT(t.id)
          ELSE 0
        END AS cost_per_turn,
        COALESCE(AVG(t.cache_hit_rate), 0) AS avg_cache_hit_rate,
        COALESCE(SUM(t.agent_spawned), 0) AS total_agents,
        CASE WHEN COUNT(t.id) > 0
          THEN COALESCE(SUM(t.agent_spawned), 0)::float / COUNT(t.id)
          ELSE 0
        END AS agent_ratio,
        COUNT(t.id) AS total_turns
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      LEFT JOIN devices d ON d.user_id = u.id
      LEFT JOIN sessions s ON s.device_id = d.id
      LEFT JOIN turns t ON t.session_id = s.id ${periodFilter}
      WHERE tm.team_id = $1
      GROUP BY u.id, u.email
      ORDER BY total_cost DESC`,
      [teamId]
    );

    return NextResponse.json({
      team,
      current_user_id: session.sub,
      members: rows.rows,
    });
  } finally {
    await pool.end();
  }
}
