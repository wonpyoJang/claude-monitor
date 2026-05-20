import { z } from "zod";

export const turnPayload = z.object({
  device: z.object({
    id: z.string().min(1).max(128),
    alias: z.string().max(64).optional().nullable(),
    hostname: z.string().max(128).optional().nullable(),
    os: z.string().max(64).optional().nullable(),
    client_version: z.string().max(32).optional().nullable(),
  }),
  session_id: z.string().min(1).max(128),
  cwd: z.string().max(512).optional().nullable(),
  ts: z.string().datetime({ offset: true }),
  model: z.string().max(64).optional().nullable(),
  tokens_input: z.number().int().nonnegative().optional().nullable(),
  tokens_output: z.number().int().nonnegative().optional().nullable(),
  tokens_cache_read: z.number().int().nonnegative().optional().nullable(),
  tokens_cache_creation: z.number().int().nonnegative().optional().nullable(),
  cost_usd: z.number().nonnegative().optional().nullable(),
  tool_calls: z.number().int().nonnegative().optional().nullable(),
  edit_calls: z.number().int().nonnegative().optional().nullable(),
  cache_hit_rate: z.number().min(0).max(1).optional().nullable(),
  impact_score: z.number().int().min(1).max(5).optional().nullable(),
  impact_source: z.string().max(32).optional().nullable(),
  impact_note: z.string().max(512).optional().nullable(),
  session_duration_s: z.number().int().nonnegative().optional().nullable(),
  file_exts: z.record(z.string(), z.number().int()).optional().nullable(),
  error_count: z.number().int().nonnegative().optional().nullable(),
  agent_spawned: z.number().int().nonnegative().optional().nullable(),
  raw: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type TurnPayload = z.infer<typeof turnPayload>;
