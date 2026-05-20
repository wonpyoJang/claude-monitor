import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Topbar from "@/app/Topbar";

export const dynamic = "force-dynamic";

type LeaderRow = {
  user_id: string;
  display_name: string;
  avatar_emoji: string | null;
  is_me: boolean;
  turns: number;
  avg_impact: number;
  cost_per_turn: number;
  cache_hit_rate: number;
  error_rate: number;
  score: number;
  rank: number;
};

function fmtScore(n: number) { return (n * 100).toFixed(1); }
function fmtCpt(n: number) {
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(5)}`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const period = periodParam === "month" ? "month" : "week";

  const auth = await getSession();
  if (!auth) redirect("/login");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let rows: LeaderRow[] = [];
  let total = 0;
  let hidden = false;
  let myRank: LeaderRow | null = null;

  try {
    const { rows: raw, rowCount } = await pool.query(
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
           AND t.ts >= NOW() - ($2 || ' days')::interval
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
               ELSE (r.avg_impact - b.min_impact) / NULLIF(b.max_impact - b.min_impact, 0) END
             + 0.30 * CASE WHEN b.max_cpt = b.min_cpt THEN 1
               ELSE 1 - (r.cost_per_turn - b.min_cpt) / NULLIF(b.max_cpt - b.min_cpt, 0) END
             + 0.20 * CASE WHEN b.max_cache = b.min_cache THEN 1
               ELSE (r.cache_hit_rate - b.min_cache) / NULLIF(b.max_cache - b.min_cache, 0) END
             + 0.10 * CASE WHEN b.max_err = b.min_err THEN 1
               ELSE 1 - (r.error_rate - b.min_err) / NULLIF(b.max_err - b.min_err, 0) END
           ) AS score
         FROM raw r, bounds b
       )
       SELECT *, RANK() OVER (ORDER BY score DESC) AS rank
       FROM scored
       ORDER BY rank`,
      [auth.sub, period === "month" ? "30" : "7"]
    );
    rows = raw as LeaderRow[];
    total = rowCount ?? 0;
    hidden = total < 3;
    myRank = rows.find((r) => r.is_me) ?? null;
  } finally {
    await pool.end();
  }

  const tabs = [
    { id: "week", label: "주간" },
    { id: "month", label: "월간" },
  ];

  return (
    <>
      <Topbar />
      <main className="page">
        <div className="breadcrumb">
          <a href="/">대시보드</a>
          <span className="sep">/</span>
          <span>리더보드</span>
        </div>

        <div style={{ marginBottom: 40 }}>
          <div className="label" style={{ marginBottom: 12 }}>에이전트 효율 랭킹</div>
          <h1 className="page-title">누가 더 잘 쓰고 있나.</h1>
        </div>

        {/* 탭 */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line-hair)", marginBottom: 32 }}>
          {tabs.map((t) => (
            <a key={t.id}
              href={`/leaderboard?period=${t.id}`}
              style={{
                padding: "10px 14px", fontSize: 13, display: "block",
                color: period === t.id ? "var(--ink)" : "var(--ink-3)",
                borderBottom: "2px solid " + (period === t.id ? "var(--ink)" : "transparent"),
                marginBottom: -1, fontWeight: 500, textDecoration: "none",
              }}>
              {t.label}
            </a>
          ))}
        </div>

        {hidden ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
            참여자가 3명 미만입니다. 설정에서 랭킹 참여를 켜세요.
          </div>
        ) : (
          <>
            {/* 내 순위 (상단 고정, 미포함 시) */}
            {myRank && (myRank.rank as number) > 3 && (
              <div style={{ marginBottom: 24, padding: "12px 16px",
                background: "var(--acc-bg)", borderRadius: 4,
                display: "flex", alignItems: "center", gap: 12,
                fontFamily: "var(--font-mono)", fontSize: 12 }}>
                <span style={{ color: "var(--acc-ink)", fontWeight: 600 }}>내 순위</span>
                <span style={{ color: "var(--acc-ink)" }}>#{myRank.rank}</span>
                <span style={{ color: "var(--ink-3)" }}>점수 {fmtScore(myRank.score)}</span>
                <span style={{ color: "var(--ink-3)" }}>/ {total}명 중</span>
              </div>
            )}

            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>순위</th>
                  <th>닉네임</th>
                  <th style={{ textAlign: "right" }}>점수</th>
                  <th style={{ textAlign: "right" }}>임팩트</th>
                  <th style={{ textAlign: "right" }}>턴당 비용</th>
                  <th style={{ textAlign: "right" }}>캐시율</th>
                  <th style={{ textAlign: "right" }}>오류율</th>
                  <th style={{ textAlign: "right" }}>턴 수</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const medal = r.rank <= 3 ? MEDALS[r.rank - 1] : null;
                  const isMe = r.is_me;
                  return (
                    <tr key={r.user_id} style={{
                      background: isMe ? "var(--acc-bg)" : r.rank === 1 ? "oklch(0.97 0.02 80)" : undefined,
                    }}>
                      <td className="mono tnum" style={{ fontSize: 15, textAlign: "center" }}>
                        {medal ?? <span style={{ color: "var(--ink-4)" }}>{r.rank}</span>}
                      </td>
                      <td>
                        <span style={{ marginRight: 6 }}>{r.avatar_emoji ?? "🧑‍💻"}</span>
                        <span style={{ fontWeight: isMe ? 600 : 400 }}>{r.display_name}</span>
                        {isMe && <span className="chip acc" style={{ marginLeft: 6, fontSize: 10, padding: "1px 5px" }}>나</span>}
                      </td>
                      <td className="mono tnum" style={{ textAlign: "right", fontWeight: 600 }}>
                        {fmtScore(r.score)}
                      </td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>
                        {r.avg_impact.toFixed(1)}
                      </td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>
                        {fmtCpt(r.cost_per_turn)}
                      </td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>
                        {(r.cache_hit_rate * 100).toFixed(0)}%
                      </td>
                      <td className="mono tnum" style={{ textAlign: "right", color: r.error_rate > 0.05 ? "var(--bad)" : "var(--ink-3)" }}>
                        {(r.error_rate * 100).toFixed(1)}%
                      </td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-4)", fontSize: 12 }}>
                        {r.turns}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ marginTop: 16, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-4)" }}>
              복합 점수 = 임팩트(40%) + 비용효율(30%) + 캐시(20%) + 오류없음(10%) · 최소 10턴 이상
            </div>
          </>
        )}

        <div style={{ marginTop: 40, padding: "16px 0", borderTop: "1px solid var(--line-hair)" }}>
          <a href="/settings" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)",
            borderBottom: "1px solid var(--line-hair)", paddingBottom: 1, textDecoration: "none" }}>
            설정에서 랭킹 참여 관리 →
          </a>
        </div>
      </main>
    </>
  );
}
