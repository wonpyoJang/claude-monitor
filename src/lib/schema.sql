-- Claude Code monitor schema

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  alias TEXT,
  hostname TEXT,
  os TEXT,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  cwd TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_turn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_turns INT NOT NULL DEFAULT 0,
  total_input_tokens BIGINT NOT NULL DEFAULT 0,
  total_output_tokens BIGINT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS turns (
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
);

CREATE INDEX IF NOT EXISTS idx_turns_ts ON turns (ts DESC);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns (session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device_last ON sessions (device_id, last_turn_at DESC);
