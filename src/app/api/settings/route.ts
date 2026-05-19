import { NextResponse } from "next/server";
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
      "SELECT ingest_token FROM users WHERE id = $1",
      [session.sub]
    );
    const row = result.rows[0] as { ingest_token: string } | undefined;
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ingest_token: row.ingest_token, monitor_url: process.env.NEXT_PUBLIC_APP_URL ?? "" });
  } finally {
    await pool.end();
  }
}
