import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    ingest_token TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    alias TEXT,
    hostname TEXT,
    os TEXT,
    client_version TEXT,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    cwd TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_turn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_turns INT NOT NULL DEFAULT 0,
    total_input_tokens BIGINT NOT NULL DEFAULT 0,
    total_output_tokens BIGINT NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS turns (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL,
    model TEXT,
    tokens_input BIGINT,
    tokens_output BIGINT,
    tokens_cache_read BIGINT,
    tokens_cache_creation BIGINT,
    cost_usd NUMERIC(12, 6),
    tool_calls INT,
    edit_calls INT,
    cache_hit_rate NUMERIC(6, 4),
    impact_score INT,
    impact_source TEXT,
    impact_note TEXT,
    raw JSONB
  )`,
  // Idempotent column additions for existing deployments (must run before indexes)
  `DO $$ BEGIN
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
  EXCEPTION WHEN OTHERS THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS client_version TEXT;
    ALTER TABLE turns ADD COLUMN IF NOT EXISTS session_duration_s INT;
    ALTER TABLE turns ADD COLUMN IF NOT EXISTS file_exts JSONB;
    ALTER TABLE turns ADD COLUMN IF NOT EXISTS error_count INT;
    ALTER TABLE turns ADD COLUMN IF NOT EXISTS agent_spawned INT;
  EXCEPTION WHEN OTHERS THEN NULL; END $$`,
  `CREATE INDEX IF NOT EXISTS idx_turns_ts ON turns (ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_turns_session ON turns (session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_device_last ON sessions (device_id, last_turn_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_user ON devices (user_id)`,
  `CREATE TABLE IF NOT EXISTS teams (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS team_members (
    team_id BIGINT REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id)`,
  `DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_emoji TEXT DEFAULT '🧑‍💻';
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS summary TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS show_in_leaderboard BOOLEAN NOT NULL DEFAULT false;
  EXCEPTION WHEN OTHERS THEN NULL; END $$`,
];

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const expected = process.env.INGEST_TOKEN ?? "";
  if (!expected || token.length !== expected.length) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  if (diff !== 0) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const stmt of SCHEMA_STATEMENTS) {
      await pool.query(stmt);
    }
  } finally {
    await pool.end();
  }

  return NextResponse.json({ ok: true, tables: ["users", "devices", "sessions", "turns", "teams", "team_members"] });
}
