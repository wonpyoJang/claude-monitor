import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const teamId = parseInt(id, 10);
  if (isNaN(teamId)) return NextResponse.json({ error: "invalid team id" }, { status: 400 });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(
      "SELECT created_by FROM teams WHERE id = $1 LIMIT 1",
      [teamId]
    );
    const team = result.rows[0] as { created_by: string } | undefined;
    if (!team) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (team.created_by !== session.sub) {
      return NextResponse.json({ error: "only the team owner can delete" }, { status: 403 });
    }
    await pool.query(
      "UPDATE teams SET deleted_at = NOW() WHERE id = $1",
      [teamId]
    );
    return NextResponse.json({ ok: true });
  } finally {
    await pool.end();
  }
}
