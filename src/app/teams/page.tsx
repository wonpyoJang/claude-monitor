import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Pool } from "@neondatabase/serverless";
import Topbar from "@/app/Topbar";
import TeamsClient from "./TeamsClient";

export const dynamic = "force-dynamic";

type TeamRow = {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  member_count: number;
  is_owner: boolean;
};

export default async function TeamsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let teams: TeamRow[] = [];
  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.invite_code, t.created_at,
              (SELECT COUNT(*) FROM team_members WHERE team_id = t.id)::int AS member_count,
              (t.created_by = $1) AS is_owner
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = $1 AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC`,
      [session.sub]
    );
    teams = result.rows as TeamRow[];
  } finally {
    await pool.end();
  }

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 24 }}>팀 랭킹</h1>
        <TeamsClient initialTeams={teams} currentUserId={session.sub} />
      </main>
    </>
  );
}
