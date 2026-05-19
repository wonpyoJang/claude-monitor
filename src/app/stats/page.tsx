import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Topbar from "@/app/Topbar";
import DailyCharts, { type DailyPoint } from "@/app/components/DailyCharts";
import ExtBarChart from "@/app/components/ExtBarChart";

export const dynamic = "force-dynamic";

type DayRow = {
  day: string;
  cost: number;
  turns: number;
  sessions: number;
  tokens_input: number;
  tokens_output: number;
  errors: number;
  agents: number;
  cache_hit_rate: number;
};

type ExtRow = { ext: string; edits: number; cost: number };
type ProjectRow = { project: string; cost: number; sessions: number; turns: number };

function fmtCost(n: number) {
  const v = Number(n);
  if (v >= 10) return `$${v.toFixed(2)}`;
  if (v >= 1)  return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}
function fmtNum(n: number) { return n.toLocaleString("en-US"); }
function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}
function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });
}

function buildTimeline(rows: DayRow[], days: number): { chart: DailyPoint[]; table: DayRow[] } {
  const map = new Map(rows.map((r) => [r.day, r]));
  const chart: DailyPoint[] = [];
  const table: DayRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    const row = map.get(key);
    chart.push({ day: label, cost: row?.cost ?? 0, turns: row?.turns ?? 0 });
    if (row) table.push(row);
  }
  table.reverse();
  return { chart, table };
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; tab?: string }>;
}) {
  const { period, tab: tabParam } = await searchParams;
  const days = period === "90" ? 90 : period === "all" ? 365 : 30;
  const tab = tabParam ?? "overview";

  const auth = await getSession();
  if (!auth) redirect("/login");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let rows: DayRow[] = [];
  let extRows: ExtRow[] = [];
  let projectRows: ProjectRow[] = [];

  try {
    const [dailyRes, extRes, projRes] = await Promise.all([
      pool.query(
        `SELECT
          to_char(DATE(t.ts), 'YYYY-MM-DD') AS day,
          COALESCE(SUM(t.cost_usd), 0)::float AS cost,
          COUNT(*)::int AS turns,
          COUNT(DISTINCT t.session_id)::int AS sessions,
          COALESCE(SUM(t.tokens_input), 0)::bigint AS tokens_input,
          COALESCE(SUM(t.tokens_output), 0)::bigint AS tokens_output,
          COALESCE(SUM(t.error_count), 0)::int AS errors,
          COALESCE(SUM(t.agent_spawned), 0)::int AS agents,
          COALESCE(AVG(t.cache_hit_rate), 0)::float AS cache_hit_rate
         FROM turns t
         JOIN devices d ON d.id = t.device_id
         WHERE d.user_id = $1
           AND t.ts >= NOW() - ($2 || ' days')::interval
         GROUP BY DATE(t.ts)
         ORDER BY DATE(t.ts) DESC`,
        [auth.sub, days]
      ),
      pool.query(
        `SELECT ext_kv.key AS ext,
           SUM(ext_kv.value::int) AS edits,
           SUM(t.cost_usd) AS cost
         FROM turns t
         JOIN devices d ON d.id = t.device_id,
         LATERAL jsonb_each_text(COALESCE(t.file_exts, '{}'::jsonb)) ext_kv
         WHERE d.user_id = $1
           AND t.ts >= NOW() - ($2 || ' days')::interval
           AND t.file_exts IS NOT NULL
         GROUP BY ext_kv.key
         ORDER BY edits DESC
         LIMIT 12`,
        [auth.sub, days]
      ),
      pool.query(
        `SELECT
           SPLIT_PART(s.cwd, '/', -1) AS project,
           SUM(t.cost_usd)::float AS cost,
           COUNT(DISTINCT t.session_id)::int AS sessions,
           COUNT(t.id)::int AS turns
         FROM turns t
         JOIN devices d ON d.id = t.device_id
         JOIN sessions s ON s.id = t.session_id
         WHERE d.user_id = $1
           AND t.ts >= NOW() - ($2 || ' days')::interval
           AND s.cwd IS NOT NULL
         GROUP BY SPLIT_PART(s.cwd, '/', -1)
         ORDER BY cost DESC
         LIMIT 15`,
        [auth.sub, days]
      ),
    ]);

    rows = dailyRes.rows as DayRow[];
    extRows = extRes.rows as ExtRow[];
    projectRows = projRes.rows as ProjectRow[];
  } finally {
    await pool.end();
  }

  const { chart, table } = buildTimeline(rows, days);

  const total = rows.reduce(
    (acc, r) => ({
      cost: acc.cost + r.cost,
      turns: acc.turns + r.turns,
      sessions: acc.sessions + r.sessions,
      tokens_input: acc.tokens_input + r.tokens_input,
      tokens_output: acc.tokens_output + r.tokens_output,
      errors: acc.errors + r.errors,
    }),
    { cost: 0, turns: 0, sessions: 0, tokens_input: 0, tokens_output: 0, errors: 0 }
  );

  const costPerTurn = total.turns > 0 ? total.cost / total.turns : 0;

  const periods = [
    { label: "30일", value: "30" },
    { label: "90일", value: "90" },
    { label: "1년", value: "all" },
  ];

  const tabs = [
    { id: "overview", label: "전체 추세" },
    { id: "languages", label: "언어별" },
    { id: "projects", label: "프로젝트별" },
  ];

  const extTotal = extRows.reduce((s, r) => s + Number(r.cost), 0);
  const projTotal = projectRows.reduce((s, r) => s + r.cost, 0);

  return (
    <>
      <Topbar />
      <main className="page">
        {/* 브레드크럼 */}
        <div className="breadcrumb">
          <a href="/">대시보드</a>
          <span className="sep">/</span>
          <span>통계</span>
        </div>

        {/* 헤더 */}
        <div style={{ marginBottom: 40 }}>
          <div className="label" style={{ marginBottom: 12 }}>기간 통계</div>
          <h1 className="page-title">
            {days === 365 ? <>지난 1년 동안<br />무슨 일이 있었나.</> :
             days === 90  ? <>지난 90일 동안<br />무슨 일이 있었나.</> :
                           <>지난 30일 동안<br />무슨 일이 있었나.</>}
          </h1>
        </div>

        {/* 요약 4개 */}
        <div className="stat-grid stat-grid-4" style={{ marginBottom: 48 }}>
          {[
            { label: "총 비용", value: fmtCost(total.cost) },
            { label: "총 턴", value: fmtNum(total.turns) },
            { label: "총 세션", value: fmtNum(total.sessions) },
            { label: "턴당 비용", value: `$${costPerTurn.toFixed(4)}` },
          ].map((item, i) => (
            <div key={i} className="stat-grid-item">
              <div className="label" style={{ marginBottom: 8 }}>{item.label}</div>
              <div className="stat-num tnum sm">{item.value}</div>
            </div>
          ))}
        </div>

        {/* 기간 선택 + 탭 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end",
          borderBottom: "1px solid var(--line-hair)", marginBottom: 0 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {tabs.map((t) => (
              <a key={t.id}
                href={`/stats?period=${period ?? "30"}&tab=${t.id}`}
                style={{
                  background: "transparent", border: 0,
                  padding: "10px 14px", fontSize: 13, display: "block",
                  color: tab === t.id ? "var(--ink)" : "var(--ink-3)",
                  borderBottom: "2px solid " + (tab === t.id ? "var(--ink)" : "transparent"),
                  marginBottom: -1, fontWeight: 500, whiteSpace: "nowrap", textDecoration: "none",
                }}>
                {t.label}
              </a>
            ))}
          </div>

          <div style={{ display: "flex", gap: 4, paddingBottom: 8 }}>
            {periods.map((p) => (
              <a key={p.value}
                href={`/stats?period=${p.value}&tab=${tab}`}
                style={{
                  padding: "4px 10px", borderRadius: 3, fontSize: 12,
                  fontFamily: "var(--font-mono)", textDecoration: "none",
                  background: String(days) === p.value ? "var(--ink)" : "transparent",
                  color: String(days) === p.value ? "var(--bg)" : "var(--ink-3)",
                  border: "1px solid " + (String(days) === p.value ? "transparent" : "var(--line-hair)"),
                }}>
                {p.label}
              </a>
            ))}
          </div>
        </div>

        {/* ── overview tab ── */}
        {tab === "overview" && (
          <>
            <div className="section">
              <div className="section-head">
                <h2>일별 비용 · 턴</h2>
                <span className="meta">{fmtCost(total.cost)} · {days}일</span>
              </div>
              <DailyCharts data={chart} />
            </div>

            <div className="section">
              <div className="section-head">
                <h2>일자별 상세</h2>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th style={{ textAlign: "right" }}>비용</th>
                    <th style={{ textAlign: "right" }}>턴</th>
                    <th style={{ textAlign: "right" }}>세션</th>
                    <th style={{ textAlign: "right" }}>턴당</th>
                    <th style={{ textAlign: "right" }}>캐시</th>
                    <th style={{ textAlign: "right" }}>에러</th>
                    <th>추세</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((r) => {
                    const maxCost = Math.max(...table.map((x) => x.cost), 0.0001);
                    return (
                      <tr key={r.day}>
                        <td className="mono" style={{ fontSize: 12 }}>{fmtDate(r.day)}</td>
                        <td className="mono tnum" style={{ textAlign: "right" }}>{fmtCost(r.cost)}</td>
                        <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>{fmtNum(r.turns)}</td>
                        <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>{fmtNum(r.sessions)}</td>
                        <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>
                          {r.turns > 0 ? `$${(r.cost / r.turns).toFixed(4)}` : "—"}
                        </td>
                        <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>
                          {r.cache_hit_rate > 0 ? `${(r.cache_hit_rate * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className="mono tnum" style={{ textAlign: "right", color: r.errors > 0 ? "var(--bad)" : "var(--ink-4)", fontSize: 12 }}>
                          {r.errors > 0 ? r.errors : "—"}
                        </td>
                        <td>
                          <div className="bar-track" style={{ width: 80 }}>
                            <div className="bar-fill" style={{ width: `${(r.cost / maxCost) * 100}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {table.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: "40px 0", color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                        데이터 없음
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── languages tab ── */}
        {tab === "languages" && (
          <div className="section" style={{ paddingTop: 32 }}>
            <div className="section-head">
              <h2>언어별 작업 분포</h2>
              <span className="meta">file_exts 집계 · 상위 {extRows.length}개</span>
            </div>
            {extRows.length === 0 ? (
              <div style={{ color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>데이터 없음</div>
            ) : (
              <>
                <div style={{ marginBottom: 32 }}>
                  <div className="label" style={{ marginBottom: 12 }}>편집 수 기준</div>
                  <ExtBarChart data={extRows.map((r) => ({ ext: r.ext, edits: Number(r.edits), cost: Number(r.cost) }))} />
                </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>확장자</th>
                    <th style={{ textAlign: "right" }}>편집 수</th>
                    <th style={{ textAlign: "right" }}>비용</th>
                    <th>비율</th>
                  </tr>
                </thead>
                <tbody>
                  {extRows.map((r) => (
                    <tr key={r.ext}>
                      <td className="mono">{r.ext}</td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>
                        {fmtNum(Number(r.edits))}
                      </td>
                      <td className="mono tnum" style={{ textAlign: "right" }}>{fmtCost(Number(r.cost))}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div className="bar-track" style={{ width: 120 }}>
                            <div className="bar-fill" style={{ width: `${(Number(r.cost) / Math.max(extTotal, 0.0001)) * 100}%` }} />
                          </div>
                          <span className="mono tnum" style={{ fontSize: 11, color: "var(--ink-3)", width: 32, textAlign: "right" }}>
                            {((Number(r.cost) / Math.max(extTotal, 0.0001)) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </>
            )}
          </div>
        )}

        {/* ── projects tab ── */}
        {tab === "projects" && (
          <div className="section" style={{ paddingTop: 32 }}>
            <div className="section-head">
              <h2>프로젝트별 작업 분포</h2>
              <span className="meta">cwd 최상위 세그먼트</span>
            </div>
            {projectRows.length === 0 ? (
              <div style={{ color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>데이터 없음</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>프로젝트</th>
                    <th style={{ textAlign: "right" }}>비용</th>
                    <th style={{ textAlign: "right" }}>세션</th>
                    <th style={{ textAlign: "right" }}>턴</th>
                    <th style={{ textAlign: "right" }}>턴당</th>
                    <th>비율</th>
                  </tr>
                </thead>
                <tbody>
                  {projectRows.map((r) => (
                    <tr key={r.project}>
                      <td className="mono">{r.project || "—"}</td>
                      <td className="mono tnum" style={{ textAlign: "right" }}>{fmtCost(r.cost)}</td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>{r.sessions}</td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>{r.turns}</td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>
                        {r.turns > 0 ? `$${(r.cost / r.turns).toFixed(4)}` : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div className="bar-track" style={{ width: 120 }}>
                            <div className="bar-fill" style={{ width: `${(r.cost / Math.max(projTotal, 0.0001)) * 100}%` }} />
                          </div>
                          <span className="mono tnum" style={{ fontSize: 11, color: "var(--ink-3)", width: 32, textAlign: "right" }}>
                            {((r.cost / Math.max(projTotal, 0.0001)) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 추가 요약 */}
        <div className="section">
          <div className="section-head"><h2>토큰 집계</h2></div>
          <div className="stat-grid stat-grid-4">
            {[
              { label: "입력 토큰", value: fmtK(total.tokens_input) },
              { label: "출력 토큰", value: fmtK(total.tokens_output) },
              { label: "총 토큰", value: fmtK(total.tokens_input + total.tokens_output) },
              { label: "에러 수", value: total.errors > 0 ? fmtNum(total.errors) : "—" },
            ].map((item, i) => (
              <div key={i} className="stat-grid-item">
                <div className="label" style={{ marginBottom: 8 }}>{item.label}</div>
                <div className="stat-num tnum xs" style={{ color: i === 3 && total.errors > 0 ? "var(--bad)" : undefined }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
