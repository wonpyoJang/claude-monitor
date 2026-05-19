import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Topbar from "./Topbar";
import ClickableTr from "./ClickableTr";
import Sparkline, { SparkPoint } from "./components/Sparkline";

export const dynamic = "force-dynamic";

type SummaryRow = {
  today_cost: string;
  week_cost: string;
  today_turns: number;
  week_turns: number;
  today_tokens: number;
  week_tokens: number;
  today_sessions: number;
  week_sessions: number;
};

type DeviceRow = {
  id: string;
  alias: string | null;
  hostname: string | null;
  os: string | null;
  last_seen: string;
  client_version: string | null;
  turns_7d: number;
  tokens_7d: number;
  cost_7d_usd: string;
  sessions_7d: number;
};

type HealthRow = {
  error_rate_7d: string;
  delegation_rate_7d: string;
  error_rate_prev: string;
  delegation_rate_prev: string;
};

type SessionRow = {
  id: string;
  device_id: string;
  device_alias: string | null;
  cwd: string | null;
  started_at: string;
  last_turn_at: string;
  total_turns: number;
  total_cost_usd: string;
  impact_score: number | null;
  error_count: number | null;
  duration_s: number | null;
  agent_spawned: number | null;
  avg_cost: string | null;
};

function fmtCostShort(n: number | string): string {
  const v = Number(n);
  if (v >= 10) return `$${v.toFixed(2)}`;
  if (v >= 1)  return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}
function fmtK(n: number | string): string {
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h 전`;
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}
function fmtDuration(s: number | null): string {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
function cwdShort(cwd: string | null): string {
  if (!cwd) return "—";
  const parts = cwd.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const fetchedAt = new Date().toISOString();
  let summary: SummaryRow = {
    today_cost: "0", week_cost: "0",
    today_turns: 0, week_turns: 0,
    today_tokens: 0, week_tokens: 0,
    today_sessions: 0, week_sessions: 0,
  };
  let devices: DeviceRow[] = [];
  let sessions: SessionRow[] = [];
  let sparkData: SparkPoint[] = [];
  let health: HealthRow = { error_rate_7d: "0", delegation_rate_7d: "0", error_rate_prev: "0", delegation_rate_prev: "0" };

  try {
    const [sumRes, devRes, sessRes, sparkRes, healthRes] = await Promise.all([
      pool.query(
        `SELECT
          COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '1 day'  THEN t.cost_usd ELSE 0 END), 0)  AS today_cost,
          COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '7 days' THEN t.cost_usd ELSE 0 END), 0)  AS week_cost,
          COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '1 day'  THEN 1 ELSE 0 END), 0)::int       AS today_turns,
          COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '7 days' THEN 1 ELSE 0 END), 0)::int       AS week_turns,
          COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '1 day'
            THEN COALESCE(t.tokens_input,0)+COALESCE(t.tokens_output,0) ELSE 0 END), 0)::bigint   AS today_tokens,
          COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '7 days'
            THEN COALESCE(t.tokens_input,0)+COALESCE(t.tokens_output,0) ELSE 0 END), 0)::bigint   AS week_tokens,
          COUNT(DISTINCT CASE WHEN t.ts >= NOW()-INTERVAL '1 day'  THEN t.session_id END)::int     AS today_sessions,
          COUNT(DISTINCT CASE WHEN t.ts >= NOW()-INTERVAL '7 days' THEN t.session_id END)::int     AS week_sessions
         FROM turns t
         JOIN devices d ON d.id = t.device_id
         WHERE d.user_id = $1`,
        [session.sub]
      ),
      pool.query(
        `SELECT
          d.id, d.alias, d.hostname, d.os, d.last_seen, d.client_version,
          COALESCE(COUNT(CASE WHEN t.ts >= NOW()-INTERVAL '7 days' THEN 1 END), 0)::int AS turns_7d,
          COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '7 days'
            THEN COALESCE(t.tokens_input,0)+COALESCE(t.tokens_output,0) ELSE 0 END), 0)::bigint AS tokens_7d,
          COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '7 days' THEN t.cost_usd ELSE 0 END), 0) AS cost_7d_usd,
          COUNT(DISTINCT CASE WHEN t.ts >= NOW()-INTERVAL '7 days' THEN t.session_id END)::int AS sessions_7d
         FROM devices d
         LEFT JOIN turns t ON t.device_id = d.id
         WHERE d.user_id = $1
         GROUP BY d.id
         ORDER BY d.last_seen DESC`,
        [session.sub]
      ),
      pool.query(
        `WITH session_data AS (
           SELECT s.id, s.device_id, d.alias AS device_alias,
             s.cwd, s.started_at, s.last_turn_at,
             s.total_turns, s.total_cost_usd,
             MAX(t.impact_score) AS impact_score,
             COALESCE(SUM(t.error_count), 0)::int AS error_count,
             SUM(t.session_duration_s)::int AS duration_s,
             COALESCE(SUM(t.agent_spawned), 0)::int AS agent_spawned
           FROM sessions s
           JOIN devices d ON d.id = s.device_id
           LEFT JOIN turns t ON t.session_id = s.id
           WHERE d.user_id = $1
           GROUP BY s.id, d.alias
         ),
         avg_data AS (
           SELECT AVG(total_cost_usd::numeric) AS avg_cost FROM session_data
         )
         SELECT sd.*, ad.avg_cost
         FROM session_data sd, avg_data ad
         ORDER BY sd.last_turn_at DESC
         LIMIT 25`,
        [session.sub]
      ),
      pool.query(
        `SELECT
           DATE_TRUNC('day', t.ts AT TIME ZONE 'UTC')::date::text AS day,
           COALESCE(SUM(t.cost_usd), 0)::float AS cost_sum,
           COUNT(*)::int AS turn_count
         FROM turns t
         JOIN devices d ON d.id = t.device_id
         WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '7 days'
         GROUP BY 1
         ORDER BY 1`,
        [session.sub]
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '7 days'
             THEN t.error_count ELSE 0 END)::float
             / NULLIF(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '7 days'
             THEN t.tool_calls ELSE 0 END), 0), 0) AS error_rate_7d,
           COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '7 days'
             THEN COALESCE(t.agent_spawned, 0) ELSE 0 END)::float
             / NULLIF(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '7 days'
             THEN 1 ELSE 0 END), 0), 0) AS delegation_rate_7d,
           COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '14 days'
             AND t.ts < NOW()-INTERVAL '7 days'
             THEN t.error_count ELSE 0 END)::float
             / NULLIF(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '14 days'
             AND t.ts < NOW()-INTERVAL '7 days'
             THEN t.tool_calls ELSE 0 END), 0), 0) AS error_rate_prev,
           COALESCE(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '14 days'
             AND t.ts < NOW()-INTERVAL '7 days'
             THEN COALESCE(t.agent_spawned, 0) ELSE 0 END)::float
             / NULLIF(SUM(CASE WHEN t.ts >= NOW()-INTERVAL '14 days'
             AND t.ts < NOW()-INTERVAL '7 days'
             THEN 1 ELSE 0 END), 0), 0) AS delegation_rate_prev
         FROM turns t
         JOIN devices d ON d.id = t.device_id
         WHERE d.user_id = $1`,
        [session.sub]
      ),
    ]);

    summary = sumRes.rows[0] as SummaryRow;
    devices = devRes.rows as DeviceRow[];
    sessions = sessRes.rows as SessionRow[];
    sparkData = sparkRes.rows
      .filter((r) => (r.turn_count as number) > 0)
      .map((r) => ({
        day: r.day as string,
        value: (r.cost_sum as number) / (r.turn_count as number),
      }));
    if (healthRes.rows[0]) health = healthRes.rows[0] as HealthRow;
  } finally {
    await pool.end();
  }

  const now = new Date(fetchedAt);
  const dateStr = now.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });

  return (
    <>
      <Topbar fetchedAt={fetchedAt} />

      <main className="page">
        {/* Editorial header */}
        <div style={{ marginBottom: 48 }}>
          <div className="label" style={{ marginBottom: 12 }}>{dateStr}</div>
          <h1 className="page-title">
            {Number(summary.week_turns) > 0
              ? <>이번 주 {summary.week_turns}턴,<br />{fmtCostShort(summary.week_cost)} 소비했습니다.</>
              : <>클로드 에이전트<br />모니터링 대시보드</>
            }
          </h1>
        </div>

        {/* 오늘 / 이번 주 요약 */}
        <div className="section" style={{ borderTop: "none", paddingTop: 0 }}>
          <div className="section-head">
            <h2>오늘</h2>
            <span className="meta">24시간 기준</span>
            <div className="spacer" />
            <h2 style={{ marginLeft: 0 }}>이번 주</h2>
            <span className="meta">7일 기준</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48 }}>
            {/* 오늘 */}
            <div className="stat-grid stat-grid-2" style={{ gap: 0 }}>
              {[
                { label: "비용", value: fmtCostShort(summary.today_cost) },
                { label: "턴 수", value: String(summary.today_turns) },
              ].map((item, i) => (
                <div key={i} className="stat-grid-item">
                  <div className="label" style={{ marginBottom: 8 }}>{item.label}</div>
                  <div className="stat-num tnum">{item.value}</div>
                </div>
              ))}
            </div>

            {/* 이번 주 */}
            <div className="stat-grid stat-grid-2" style={{ gap: 0 }}>
              {[
                { label: "비용", value: fmtCostShort(summary.week_cost) },
                { label: "턴 수", value: String(summary.week_turns) },
              ].map((item, i) => (
                <div key={i} className="stat-grid-item">
                  <div className="label" style={{ marginBottom: 8 }}>{item.label}</div>
                  <div className="stat-num tnum">{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 24, display: "flex", gap: 32 }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              오늘 토큰 <span style={{ color: "var(--ink-2)" }}>{fmtK(summary.today_tokens)}</span>
            </span>
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              오늘 세션 <span style={{ color: "var(--ink-2)" }}>{summary.today_sessions}</span>
            </span>
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              주간 토큰 <span style={{ color: "var(--ink-2)" }}>{fmtK(summary.week_tokens)}</span>
            </span>
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              주간 세션 <span style={{ color: "var(--ink-2)" }}>{summary.week_sessions}</span>
            </span>
          </div>

          {sparkData.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="label" style={{ marginBottom: 6, color: "var(--ink-4)" }}>
                7일 cost/turn 추세
              </div>
              <Sparkline data={sparkData} />
            </div>
          )}
        </div>

        {/* 에이전트 건강 지표 */}
        {(() => {
          const errRate = Number(health.error_rate_7d);
          const delRate = Number(health.delegation_rate_7d);
          const successRate = 1 - errRate;
          const errPrev = Number(health.error_rate_prev);
          const delPrev = Number(health.delegation_rate_prev);
          const successPrev = 1 - errPrev;

          function trend(curr: number, prev: number, lowerIsBetter: boolean) {
            if (prev === 0) return null;
            const diff = curr - prev;
            const pct = Math.abs(diff / prev) * 100;
            if (pct < 1) return null;
            const improved = lowerIsBetter ? diff < 0 : diff > 0;
            return {
              label: `${improved ? "↓" : "↑"} ${pct.toFixed(0)}%`,
              good: improved,
            };
          }

          const cards = [
            { label: "오류율", value: `${(errRate * 100).toFixed(1)}%`, hint: "↓ 낮을수록 좋음", tr: trend(errRate, errPrev, true) },
            { label: "위임율", value: `${(delRate * 100).toFixed(1)}%`, hint: "참고용", tr: trend(delRate, delPrev, false) },
            { label: "성공률", value: `${(successRate * 100).toFixed(1)}%`, hint: "↑ 높을수록 좋음", tr: trend(successRate, successPrev, false) },
          ];

          return (
            <div className="section">
              <div className="section-head">
                <h2>에이전트 건강</h2>
                <span className="meta">7일 기준 · 이전 7일 대비</span>
              </div>
              <div className="stat-grid stat-grid-3">
                {cards.map((c) => (
                  <div key={c.label} className="stat-grid-item">
                    <div className="label" style={{ marginBottom: 8 }}>{c.label}</div>
                    <div className="stat-num tnum">{c.value}</div>
                    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{c.hint}</span>
                      {c.tr && (
                        <span className={`chip ${c.tr.good ? "acc" : "bad"}`} style={{ fontSize: 10, padding: "1px 5px" }}>
                          {c.tr.label}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* 디바이스 함대 */}
        <div className="section">
          <div className="section-head">
            <h2>디바이스 함대</h2>
            <span className="meta">{devices.length}대 등록</span>
          </div>

          {devices.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
              아직 데이터 없음 —{" "}
              <a href="/settings" style={{ borderBottom: "1px solid var(--line-hair)", paddingBottom: 1 }}>설정</a>에서 클라이언트를 설치하세요.
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>디바이스</th>
                  <th>호스트</th>
                  <th>마지막 활동</th>
                  <th style={{ textAlign: "right" }}>7일 비용</th>
                  <th style={{ textAlign: "right" }}>7일 턴</th>
                  <th style={{ textAlign: "right" }}>7일 세션</th>
                  <th style={{ textAlign: "right" }}>버전</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const name = d.alias ?? d.hostname ?? d.id.slice(0, 8);
                  const isActive = new Date(d.last_seen).getTime() > Date.now() - 5 * 60 * 1000;
                  return (
                    <ClickableTr key={d.id} href={`/devices/${d.id}`} className="clickable">
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                          <span className={`dot ${isActive ? "live" : "idle"}`} />
                          <span style={{ fontWeight: 500 }}>{name}</span>
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                        {d.hostname ?? "—"}
                        {d.os && <span style={{ marginLeft: 8, color: "var(--ink-4)" }}>{d.os}</span>}
                      </td>
                      <td className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                        {fmtTime(d.last_seen)}
                      </td>
                      <td className="mono tnum" style={{ textAlign: "right" }}>{fmtCostShort(d.cost_7d_usd)}</td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>{d.turns_7d}</td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>{d.sessions_7d}</td>
                      <td className="mono" style={{ textAlign: "right", color: "var(--ink-4)", fontSize: 11 }}>
                        {d.client_version ? `v${d.client_version}` : "—"}
                      </td>
                    </ClickableTr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 최근 세션 */}
        <div className="section">
          <div className="section-head">
            <h2>최근 세션</h2>
            <span className="meta">{sessions.length}개</span>
            <div className="spacer" />
            <a href="/stats" className="link">전체 통계 →</a>
          </div>

          <table className="tbl">
            <thead>
              <tr>
                <th>최근 활동</th>
                <th>디바이스</th>
                <th>작업 경로</th>
                <th style={{ textAlign: "right" }}>소요</th>
                <th style={{ textAlign: "right" }}>턴</th>
                <th style={{ textAlign: "right" }}>비용</th>
                <th style={{ textAlign: "right" }}>임팩트</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const cost = Number(s.total_cost_usd) || 0;
                const avgCost = Number(s.avg_cost) || 0;
                const isHighCost = avgCost > 0 && cost > avgCost * 2;
                const hasError = (s.error_count ?? 0) > 0;
                const hasAgent = (s.agent_spawned ?? 0) > 0;
                return (
                  <ClickableTr key={s.id} href={`/sessions/${s.id}`} className="clickable">
                    <td className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {fmtTime(s.last_turn_at)}
                    </td>
                    <td style={{ color: "var(--ink-3)", fontSize: 13 }}>
                      {s.device_alias ?? s.device_id.slice(0, 8)}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--ink-3)", maxWidth: "14rem" }}>
                      <span className="tbl-truncate" title={s.cwd ?? ""}>{cwdShort(s.cwd)}</span>
                    </td>
                    <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)", fontSize: 12 }}>
                      {fmtDuration(s.duration_s)}
                    </td>
                    <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>
                      {s.total_turns}
                    </td>
                    <td className="mono tnum" style={{ textAlign: "right" }}>
                      <span style={{ color: isHighCost ? "oklch(0.65 0.12 55)" : undefined }}>
                        {fmtCostShort(s.total_cost_usd)}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                        {hasError && <span className="dot bad" title={`오류 ${s.error_count}건`} />}
                        {hasAgent && (
                          <span className="chip" style={{ background: "oklch(0.92 0.04 250)", color: "oklch(0.40 0.10 250)", borderColor: "transparent", fontSize: 10, padding: "1px 5px" }} title={`에이전트 ${s.agent_spawned}회`}>
                            ⇂
                          </span>
                        )}
                        {s.impact_score != null ? (
                          <span className={`chip ${s.impact_score >= 4 ? "acc" : ""}`}>
                            {s.impact_score}/5
                          </span>
                        ) : (
                          <span style={{ color: "var(--ink-5)", fontSize: 12 }}>—</span>
                        )}
                      </div>
                    </td>
                  </ClickableTr>
                );
              })}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "40px 0", color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    세션 없음
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
