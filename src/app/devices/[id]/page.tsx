import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Topbar from "@/app/Topbar";
import ClickableTr from "@/app/ClickableTr";
import DailyCharts, { type DailyPoint } from "@/app/components/DailyCharts";
import DeviceEfficiencyCharts, { type EfficiencyPoint } from "@/app/components/DeviceEfficiencyCharts";

export const dynamic = "force-dynamic";

type DeviceMeta = {
  id: string;
  alias: string | null;
  hostname: string | null;
  os: string | null;
  client_version: string | null;
  first_seen: string;
  last_seen: string;
};

type SessionRow = {
  id: string;
  cwd: string | null;
  title: string | null;
  started_at: string;
  last_turn_at: string;
  total_turns: number;
  total_cost_usd: string;
  impact_score: number | null;
};

type StatRow = {
  total_cost: string;
  total_turns: number;
  total_sessions: number;
  total_errors: number;
  avg_cache_hit: number;
};

type DailyRow = { day: string; cost: number; turns: number };
type EfficiencyRow = { day: string; cache_rate: string | null; error_rate: string | null };

function fmtCost(n: string | number | null) {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 10) return `$${v.toFixed(2)}`;
  if (v >= 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}
function fmtNum(n: number | string | null) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US");
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h 전`;
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
function cwdShort(cwd: string | null) {
  if (!cwd) return "—";
  const parts = cwd.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}

function buildDailyTimeline(rows: DailyRow[]): DailyPoint[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  const result: DailyPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    const row = map.get(key);
    result.push({ day: label, cost: row?.cost ?? 0, turns: row?.turns ?? 0 });
  }
  return result;
}

function buildEfficiencyTimeline(rows: EfficiencyRow[]): EfficiencyPoint[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  const result: EfficiencyPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    const row = map.get(key);
    result.push({
      day: label,
      cacheRate: row?.cache_rate != null ? Number(row.cache_rate) : null,
      errorRate: row?.error_rate != null ? Number(row.error_rate) : null,
    });
  }
  return result;
}

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await getSession();
  if (!auth) redirect("/login");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let device: DeviceMeta | null = null;
  let sessions: SessionRow[] = [];
  let stats: StatRow = { total_cost: "0", total_turns: 0, total_sessions: 0, total_errors: 0, avg_cache_hit: 0 };
  let dailyData: DailyPoint[] = [];
  let efficiencyData: EfficiencyPoint[] = [];

  try {
    const [devRes, sessRes, statRes, dailyRes, effRes] = await Promise.all([
      pool.query("SELECT * FROM devices WHERE id = $1 AND user_id = $2", [id, auth.sub]),
      pool.query(
        `SELECT s.id, s.cwd, s.title, s.started_at, s.last_turn_at, s.total_turns, s.total_cost_usd,
           MAX(t.impact_score) AS impact_score
         FROM sessions s
         LEFT JOIN turns t ON t.session_id = s.id
         WHERE s.device_id = $1
         GROUP BY s.id
         ORDER BY s.last_turn_at DESC LIMIT 15`,
        [id]
      ),
      pool.query(
        `SELECT
          COALESCE(SUM(t.cost_usd), 0) AS total_cost,
          COUNT(t.id)::int AS total_turns,
          COUNT(DISTINCT t.session_id)::int AS total_sessions,
          COALESCE(SUM(t.error_count), 0)::int AS total_errors,
          COALESCE(AVG(t.cache_hit_rate), 0)::float AS avg_cache_hit
         FROM turns t WHERE t.device_id = $1`,
        [id]
      ),
      pool.query(
        `SELECT
          to_char(DATE(ts), 'YYYY-MM-DD') AS day,
          COALESCE(SUM(cost_usd), 0)::float AS cost,
          COUNT(*)::int AS turns
         FROM turns
         WHERE device_id = $1 AND ts >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(ts)
         ORDER BY DATE(ts)`,
        [id]
      ),
      pool.query(
        `SELECT
          to_char(DATE(ts), 'YYYY-MM-DD') AS day,
          COALESCE(AVG(cache_hit_rate), 0)::text AS cache_rate,
          COALESCE(
            SUM(error_count)::float / NULLIF(SUM(tool_calls), 0),
            0
          )::text AS error_rate
         FROM turns
         WHERE device_id = $1 AND ts >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(ts)
         ORDER BY DATE(ts)`,
        [id]
      ),
    ]);

    if (devRes.rows.length === 0) return notFound();
    device = devRes.rows[0] as DeviceMeta;
    sessions = sessRes.rows as SessionRow[];
    stats = statRes.rows[0] as StatRow;
    dailyData = buildDailyTimeline(dailyRes.rows as DailyRow[]);
    efficiencyData = buildEfficiencyTimeline(effRes.rows as EfficiencyRow[]);
  } finally {
    await pool.end();
  }

  const name = device!.alias ?? device!.hostname ?? id.slice(0, 8);
  const isActive = new Date(device!.last_seen).getTime() > Date.now() - 5 * 60 * 1000;
  const costPerTurn = stats.total_turns > 0 ? Number(stats.total_cost) / stats.total_turns : 0;
  const latestSession = sessions[0] ?? null;
  const hasEfficiencyData = efficiencyData.some((d) => d.cacheRate !== null || d.errorRate !== null);

  return (
    <>
      <Topbar />
      <main className="page">
        {/* 브레드크럼 */}
        <div className="breadcrumb">
          <a href="/">대시보드</a>
          <span className="sep">/</span>
          <span>디바이스</span>
          <span className="sep">/</span>
          <span>{name}</span>
        </div>

        {/* 헤더 + 현재 작업 패널 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 48, marginBottom: 48, alignItems: "start" }}>
          <div>
            <div className="label" style={{ marginBottom: 12 }}>
              <span className={`dot ${isActive ? "live" : "idle"}`} />
              {isActive ? "현재 활성" : `마지막 활동 ${fmtTime(device!.last_seen)}`}
              {device!.os && <span style={{ marginLeft: 12, color: "var(--ink-4)" }}>· {device!.os}</span>}
            </div>
            <h1 className="page-title">{name}</h1>
            {device!.hostname && (
              <div className="mono" style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 6 }}>
                {device!.hostname}
                {device!.client_version && <span style={{ marginLeft: 12 }}>v{device!.client_version}</span>}
              </div>
            )}
          </div>

          {/* 현재 작업 패널 */}
          {latestSession && (
            <a href={`/sessions/${latestSession.id}`} style={{
              display: "block", textDecoration: "none",
              border: "1px solid var(--line-soft)", borderRadius: 8,
              padding: "16px 20px", minWidth: 220, maxWidth: 280,
              background: "var(--surface)",
            }}>
              <div className="label" style={{ marginBottom: 8, fontSize: 10 }}>현재 / 최근 작업</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)", marginBottom: 4 }}>
                {latestSession.title ?? cwdShort(latestSession.cwd)}
              </div>
              {latestSession.title && (
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 6 }}>
                  {cwdShort(latestSession.cwd)}
                </div>
              )}
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {fmtTime(latestSession.last_turn_at)}
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)" }}>
                <span>{latestSession.total_turns} 턴</span>
                <span>·</span>
                <span>{fmtCost(latestSession.total_cost_usd)}</span>
              </div>
            </a>
          )}
        </div>

        {/* 누적 통계 */}
        <div className="stat-grid stat-grid-4" style={{ marginBottom: 48 }}>
          {[
            { label: "총 비용", value: fmtCost(stats.total_cost) },
            { label: "총 턴", value: fmtNum(stats.total_turns) },
            { label: "총 세션", value: fmtNum(stats.total_sessions) },
            { label: "턴당 비용", value: `$${costPerTurn.toFixed(4)}` },
          ].map((item, i) => (
            <div key={i} className="stat-grid-item">
              <div className="label" style={{ marginBottom: 8 }}>{item.label}</div>
              <div className="stat-num tnum sm">{item.value}</div>
            </div>
          ))}
        </div>

        {/* 효율 추세 차트 (캐시율 + 에러율) */}
        {hasEfficiencyData && (
          <div className="section" style={{ borderTop: "none", paddingTop: 0 }}>
            <div className="section-head">
              <h2>효율 추세</h2>
              <span className="meta">30일 · 캐시율 평균 {stats.avg_cache_hit > 0 ? `${(stats.avg_cache_hit * 100).toFixed(0)}%` : "—"}</span>
            </div>
            <DeviceEfficiencyCharts data={efficiencyData} />
          </div>
        )}

        {/* 30일 비용/턴 차트 */}
        <div className="section" style={{ borderTop: "none", paddingTop: 0 }}>
          <div className="section-head">
            <h2>30일 비용 · 턴 추세</h2>
            <span className="meta">에러 {stats.total_errors > 0 ? stats.total_errors : "없음"}</span>
          </div>
          <DailyCharts data={dailyData} />
        </div>

        {/* 최근 세션 */}
        <div className="section">
          <div className="section-head">
            <h2>이 디바이스의 세션</h2>
            <span className="meta">최근 {sessions.length}개</span>
          </div>

          <table className="tbl">
            <thead>
              <tr>
                <th>최근 활동</th>
                <th>작업</th>
                <th style={{ textAlign: "right" }}>턴</th>
                <th style={{ textAlign: "right" }}>비용</th>
                <th style={{ textAlign: "right" }}>임팩트</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <ClickableTr key={s.id} href={`/sessions/${s.id}`} className="clickable">
                  <td className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {fmtTime(s.last_turn_at)}
                  </td>
                  <td style={{ maxWidth: "18rem" }}>
                    <div style={{ fontWeight: s.title ? 500 : 400, fontSize: 13, color: s.title ? "var(--ink)" : "var(--ink-3)" }}>
                      <span className="tbl-truncate" title={s.title ?? s.cwd ?? ""}>
                        {s.title ?? cwdShort(s.cwd)}
                      </span>
                    </div>
                    {s.title && (
                      <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
                        <span className="tbl-truncate" title={s.cwd ?? ""}>{cwdShort(s.cwd)}</span>
                      </div>
                    )}
                  </td>
                  <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>
                    {s.total_turns}
                  </td>
                  <td className="mono tnum" style={{ textAlign: "right" }}>
                    {fmtCost(s.total_cost_usd)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {s.impact_score != null ? (
                      <span className={`chip ${s.impact_score >= 4 ? "acc" : ""}`}>
                        {s.impact_score}/5
                      </span>
                    ) : <span style={{ color: "var(--ink-5)" }}>—</span>}
                  </td>
                </ClickableTr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "40px 0", color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
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
