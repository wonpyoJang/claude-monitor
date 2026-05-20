import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { extractBearerToken, getUserByIngestToken } from "@/lib/auth";
import { turnPayload } from "@/lib/ingest-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = extractBearerToken(req);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let user: { id: string; email: string } | null = null;
  try {
    user = await getUserByIngestToken(pool, token);
  } catch {
    await pool.end();
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
  if (!user) {
    await pool.end();
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    await pool.end();
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = turnPayload.safeParse(body);
  if (!parsed.success) {
    await pool.end();
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 });
  }
  const t = parsed.data;

  try {
    await pool.query(
      `INSERT INTO devices (id, user_id, alias, hostname, os, client_version, first_seen, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         alias = COALESCE(EXCLUDED.alias, devices.alias),
         hostname = COALESCE(EXCLUDED.hostname, devices.hostname),
         os = COALESCE(EXCLUDED.os, devices.os),
         client_version = COALESCE(EXCLUDED.client_version, devices.client_version),
         last_seen = NOW()`,
      [t.device.id, user.id, t.device.alias, t.device.hostname, t.device.os, t.device.client_version ?? null]
    );

    await pool.query(
      `INSERT INTO sessions (id, device_id, cwd, started_at, last_turn_at,
         total_turns, total_input_tokens, total_output_tokens, total_cost_usd)
       VALUES ($1, $2, $3, $4, $4, 1, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         last_turn_at = GREATEST(sessions.last_turn_at, EXCLUDED.last_turn_at),
         total_turns = sessions.total_turns + 1,
         total_input_tokens = sessions.total_input_tokens + $5,
         total_output_tokens = sessions.total_output_tokens + $6,
         total_cost_usd = sessions.total_cost_usd + $7,
         cwd = COALESCE(EXCLUDED.cwd, sessions.cwd)`,
      [t.session_id, t.device.id, t.cwd ?? null, t.ts, t.tokens_input ?? 0, t.tokens_output ?? 0, t.cost_usd ?? 0]
    );

    await pool.query(
      `INSERT INTO turns (
         session_id, device_id, ts, model,
         tokens_input, tokens_output, tokens_cache_read, tokens_cache_creation,
         cost_usd, tool_calls, edit_calls, cache_hit_rate,
         impact_score, impact_source, impact_note,
         session_duration_s, file_exts, error_count, agent_spawned,
         raw
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        t.session_id, t.device.id, t.ts, t.model ?? null,
        t.tokens_input ?? null, t.tokens_output ?? null,
        t.tokens_cache_read ?? null, t.tokens_cache_creation ?? null,
        t.cost_usd ?? null, t.tool_calls ?? null, t.edit_calls ?? null,
        t.cache_hit_rate ?? null, t.impact_score ?? null,
        t.impact_source ?? null, t.impact_note ?? null,
        t.session_duration_s ?? null,
        t.file_exts ? JSON.stringify(t.file_exts) : null,
        t.error_count ?? null, t.agent_spawned ?? null,
        JSON.stringify(t.raw ?? null),
      ]
    );
  } finally {
    await pool.end();
  }

  return NextResponse.json({ ok: true });
}
