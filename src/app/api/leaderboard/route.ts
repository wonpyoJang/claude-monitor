import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await getSession();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const period = req.nextUrl.searchParams.get("period") === "month" ? "month" : "week";
  const interval = period === "month" ? "30 days" : "7 days";

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `WITH raw AS (
         SELECT
           u.id AS user_id,
           COALESCE(u.display_name, split_part(u.email, '@', 1)) AS display_name,
           u.avatar_emoji,
           u.id = $1 AS is_me,
           COUNT(t.id)::int AS turns,
           COALESCE(AVG(t.impact_score), 0)::float AS avg_impact,
           COALESCE(SUM(t.cost_usd)::float / NULLIF(COUNT(t.id), 0), 0) AS cost_per_turn,
           COALESCE(AVG(t.cache_hit_rate), 0)::float AS cache_hit_rate,
           COALESCE(
             SUM(t.error_count)::float / NULLIF(SUM(t.tool_calls), 0), 0
           ) AS error_rate
         FROM users u
         JOIN devices d ON d.user_id = u.id
         JOIN turns t ON t.device_id = d.id
         WHERE u.show_in_leaderboard = true
           AND t.ts >= NOW() - ($2::text || ' days')::interval
         GROUP BY u.id
         HAVING COUNT(t.id) >= 10
       ),
       bounds AS (
         SELECT
           MAX(avg_impact) AS max_impact, MIN(avg_impact) AS min_impact,
           MAX(cost_per_turn) AS max_cpt, MIN(cost_per_turn) AS min_cpt,
           MAX(cache_hit_rate) AS max_cache, MIN(cache_hit_rate) AS min_cache,
           MAX(error_rate) AS max_err, MIN(error_rate) AS min_err
         FROM raw
       ),
       scored AS (
         SELECT r.*,
           (
             0.40 * CASE WHEN b.max_impact = b.min_impact THEN 1
               ELSE (r.avg_impact - b.min_impact) / (b.max_impact - b.min_impact) END
             + 0.30 * CASE WHEN b.max_cpt = b.min_cpt THEN 1
               ELSE 1 - (r.cost_per_turn - b.min_cpt) / (b.max_cpt - b.min_cpt) END
             + 0.20 * CASE WHEN b.max_cache = b.min_cache THEN 1
               ELSE (r.cache_hit_rate - b.min_cache) / (b.max_cache - b.min_cache) END
             + 0.10 * CASE WHEN b.max_err = b.min_err THEN 1
               ELSE 1 - (r.error_rate - b.min_err) / (b.max_err - b.min_err) END
           ) AS score
         FROM raw r, bounds b
       )
       SELECT *, RANK() OVER (ORDER BY score DESC) AS rank
       FROM scored
       ORDER BY rank`,
      [auth.sub, period === "month" ? "30" : "7"]
    );

    // Include current user even if not opted in (for "내 순위")
    let myRank = rows.find((r) => r.is_me);
    if (!myRank) {
      const myRes = await pool.query(
        `SELECT
           COUNT(t.id)::int AS turns,
           COALESCE(AVG(t.impact_score), 0)::float AS avg_impact,
           COALESCE(SUM(t.cost_usd)::float / NULLIF(COUNT(t.id), 0), 0) AS cost_per_turn,
           COALESCE(AVG(t.cache_hit_rate), 0)::float AS cache_hit_rate,
           COALESCE(SUM(t.error_count)::float / NULLIF(SUM(t.tool_calls), 0), 0) AS error_rate
         FROM users u
         JOIN devices d ON d.user_id = u.id
         JOIN turns t ON t.device_id = d.id
         WHERE u.id = $1 AND t.ts >= NOW() - ($2::text || ' days')::interval`,
        [auth.sub, period === "month" ? "30" : "7"]
      );
      if (myRes.rows[0]?.turns >= 10) {
        myRank = { ...myRes.rows[0], user_id: auth.sub, is_me: true, score: null, rank: null, display_name: null };
      }
    }

    return NextResponse.json({
      period,
      rows: rows.slice(0, 20),
      total: rows.length,
      my_rank: myRank ?? null,
      hidden: rows.length < 3,
    });
  } finally {
    await pool.end();
  }
}
