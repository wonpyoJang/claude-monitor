import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Topbar from "@/app/Topbar";
import TurnCharts, { type TurnPoint, type FileExtData } from "./TurnCharts";

export const dynamic = "force-dynamic";

type TurnRow = {
  id: number;
  ts: string;
  model: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_cache_read: number | null;
  tokens_cache_creation: number | null;
  cost_usd: string | null;
  tool_calls: number | null;
  edit_calls: number | null;
  error_count: number | null;
  agent_spawned: number | null;
  file_exts: Record<string, number> | null;
  impact_score: number | null;
  impact_note: string | null;
  cache_hit_rate: number | null;
};

type SessionMeta = {
  id: string;
  cwd: string | null;
  started_at: string;
  last_turn_at: string;
  total_turns: number;
  total_input_tokens: string;
  total_output_tokens: string;
  total_cost_usd: string;
  device_alias: string | null;
  device_id: string;
  device_hostname: string | null;
  device_os: string | null;
  device_client_version: string | null;
  duration_s: number | null;
  title: string | null;
  summary: string | null;
};

function fmtCost(n: string | number | null) {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(6)}`;
}
function fmtNum(n: number | string | null) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US");
}
function fmtK(n: number | string | null) {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}
function fmtDuration(s: number | null) {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { hour12: false });
}
function fmtTimeShort(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = ["context", "harness"].includes(tabParam ?? "") ? (tabParam as string) : "overview";

  const auth = await getSession();
  if (!auth) redirect("/login");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let meta: SessionMeta | null = null;
  let turns: TurnRow[] = [];

  try {
    const [metaRes, turnsRes] = await Promise.all([
      pool.query(
        `SELECT s.*, d.alias AS device_alias, d.id AS device_id,
           d.hostname AS device_hostname, d.os AS device_os,
           d.client_version AS device_client_version,
           (SELECT SUM(t2.session_duration_s) FROM turns t2 WHERE t2.session_id = s.id) AS duration_s
         FROM sessions s
         JOIN devices d ON d.id = s.device_id
         WHERE s.id = $1 AND d.user_id = $2`,
        [id, auth.sub]
      ),
      pool.query(
        `SELECT t.id, t.ts, t.model, t.tokens_input, t.tokens_output,
           t.tokens_cache_read, t.tokens_cache_creation,
           t.cost_usd, t.tool_calls, t.edit_calls, t.error_count,
           t.agent_spawned, t.file_exts, t.impact_score, t.impact_note,
           t.cache_hit_rate
         FROM turns t
         JOIN sessions s ON s.id = t.session_id
         JOIN devices d ON d.id = s.device_id
         WHERE t.session_id = $1 AND d.user_id = $2
         ORDER BY t.ts ASC`,
        [id, auth.sub]
      ),
    ]);

    if (metaRes.rows.length === 0) return notFound();
    meta = metaRes.rows[0] as SessionMeta;
    turns = turnsRes.rows as TurnRow[];
  } finally {
    await pool.end();
  }

  // 공통 집계
  const totalCacheRead = turns.reduce((s, t) => s + (t.tokens_cache_read ?? 0), 0);
  const avgCacheHit = turns.length > 0
    ? turns.reduce((s, t) => s + (t.cache_hit_rate ?? 0), 0) / turns.length
    : 0;
  const lastImpactTurn = [...turns].reverse().find((t) => t.impact_note);
  const totalErrors = turns.reduce((s, t) => s + (t.error_count ?? 0), 0);
  const totalAgents = turns.reduce((s, t) => s + (t.agent_spawned ?? 0), 0);

  // 파일 확장자 집계
  const extMap: Record<string, number> = {};
  for (const t of turns) {
    if (t.file_exts) {
      for (const [ext, cnt] of Object.entries(t.file_exts)) {
        extMap[ext] = (extMap[ext] ?? 0) + cnt;
      }
    }
  }
  const fileExts: FileExtData[] = Object.entries(extMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ext, count]) => ({ ext, count }));

  // 차트 데이터
  const turnPoints: TurnPoint[] = turns.map((t, i) => ({
    idx: i + 1,
    cost: Number(t.cost_usd ?? 0),
    input: t.tokens_input ?? 0,
    output: t.tokens_output ?? 0,
    tools: t.tool_calls ?? 0,
    edits: t.edit_calls ?? 0,
    errors: t.error_count ?? 0,
  }));

  // 가장 비싼 턴 3개
  const topCostly = [...turns]
    .sort((a, b) => Number(b.cost_usd ?? 0) - Number(a.cost_usd ?? 0))
    .slice(0, 3);

  // 사용된 모델 목록
  const models = [...new Set(turns.map((t) => t.model).filter(Boolean))];

  // Context: 토큰 합계
  const totalInput = turns.reduce((s, t) => s + (t.tokens_input ?? 0), 0);
  const totalOutput = turns.reduce((s, t) => s + (t.tokens_output ?? 0), 0);
  const totalCacheCreate = turns.reduce((s, t) => s + (t.tokens_cache_creation ?? 0), 0);
  const totalAllTokens = totalInput + totalOutput + totalCacheRead + totalCacheCreate;

  const sessionUrl = `/sessions/${id}`;
  const tabs = [
    { id: "overview", label: "개요" },
    { id: "context", label: "컨텍스트" },
    { id: "harness", label: "Harness" },
  ];

  return (
    <>
      <Topbar />
      <main className="page">
        {/* 브레드크럼 */}
        <div className="breadcrumb">
          <a href="/">대시보드</a>
          <span className="sep">/</span>
          <a href={`/devices/${meta!.device_id}`}>
            {meta!.device_alias ?? meta!.device_id.slice(0, 8)}
          </a>
          <span className="sep">/</span>
          <span>{id.slice(0, 8)}</span>
        </div>

        {/* 세션 헤더 */}
        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="chip">{id.slice(0, 16)}</span>
          {totalErrors > 0 && <span className="chip bad">{totalErrors} 에러</span>}
        </div>

        <h1 className="page-title" style={{ fontSize: 32 }}>
          {meta!.title ?? (meta!.cwd ? meta!.cwd.split("/").slice(-2).join("/") : "세션 상세")}
        </h1>
        {meta!.summary && (
          <p style={{ marginTop: 8, marginBottom: 0, color: "var(--ink-3)", fontSize: 14, maxWidth: "52rem" }}>
            {meta!.summary}
          </p>
        )}

        {/* 메타 정보 */}
        <div style={{ display: "flex", gap: 24, marginTop: 16, paddingTop: 16,
          borderTop: "1px solid var(--line-hair)", flexWrap: "wrap",
          fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>
          <span>시작 · <span style={{ color: "var(--ink-2)" }}>{fmtTime(meta!.started_at)}</span></span>
          <span>소요 · <span style={{ color: "var(--ink-2)" }}>{fmtDuration(meta!.duration_s)}</span></span>
          <span>디바이스 · <a href={`/devices/${meta!.device_id}`} style={{ color: "var(--ink-2)", borderBottom: "1px solid var(--line-hair)", paddingBottom: 1 }}>
            {meta!.device_alias ?? meta!.device_id.slice(0, 8)}
          </a></span>
          {meta!.cwd && <span>cwd · <span style={{ color: "var(--ink-2)" }}>{meta!.cwd}</span></span>}
        </div>

        {/* 4개 지표 */}
        <div className="stat-grid stat-grid-4" style={{ marginTop: 48 }}>
          {[
            { label: "총 비용", value: fmtCost(meta!.total_cost_usd), sub: `${meta!.total_turns}턴` },
            { label: "입력 · 출력 토큰",
              value: fmtK(Number(meta!.total_input_tokens) + Number(meta!.total_output_tokens)),
              sub: `${fmtK(meta!.total_input_tokens)} in · ${fmtK(meta!.total_output_tokens)} out` },
            { label: "캐시 적중률",
              value: avgCacheHit > 0 ? `${(avgCacheHit * 100).toFixed(0)}%` : "—",
              sub: totalCacheRead > 0 ? `캐시 읽기 ${fmtK(totalCacheRead)} tok` : "캐시 없음" },
            { label: "임팩트",
              value: lastImpactTurn?.impact_score != null ? `${lastImpactTurn.impact_score}/5` : "—",
              sub: lastImpactTurn?.impact_note?.slice(0, 40) ?? "마킹 없음" },
          ].map((item, i) => (
            <div key={i} className="stat-grid-item">
              <div className="label" style={{ marginBottom: 8 }}>{item.label}</div>
              <div className="stat-num tnum sm">{item.value}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8 }}>{item.sub}</div>
            </div>
          ))}
        </div>

        {/* 서브탭 */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line-hair)", marginTop: 40, marginBottom: 0 }}>
          {tabs.map((t) => (
            <a key={t.id} href={`${sessionUrl}?tab=${t.id}`}
              style={{
                padding: "10px 14px", fontSize: 13, display: "block",
                color: tab === t.id ? "var(--ink)" : "var(--ink-3)",
                borderBottom: "2px solid " + (tab === t.id ? "var(--ink)" : "transparent"),
                marginBottom: -1, fontWeight: 500, textDecoration: "none",
              }}>
              {t.label}
            </a>
          ))}
        </div>

        {/* ── 개요 탭 ── */}
        {tab === "overview" && (
          <>
            {turnPoints.length >= 2 && (
              <div className="section">
                <div className="section-head">
                  <h2>턴별 차트</h2>
                  <span className="meta">{turns.length}턴</span>
                </div>
                <TurnCharts turns={turnPoints} fileExts={fileExts} />
              </div>
            )}

            {topCostly.length > 0 && (
              <div className="section">
                <div className="section-head">
                  <h2>가장 비싼 턴</h2>
                  <span className="meta">상위 {topCostly.length}개</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(topCostly.length, 3)}, 1fr)`, gap: 16 }}>
                  {topCostly.map((t, i) => {
                    const idx = turns.indexOf(t) + 1;
                    return (
                      <div key={i} className="card">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span className="label">Turn {idx}</span>
                          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{fmtTimeShort(t.ts)}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "12px 0" }}>
                          <span className="stat-num tnum xs">{fmtCost(t.cost_usd)}</span>
                          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                            {fmtK((t.tokens_input ?? 0) + (t.tokens_output ?? 0))} tok · {t.tool_calls ?? 0} tools
                          </span>
                        </div>
                        {t.impact_note && (
                          <p style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.45 }}>
                            {t.impact_note}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="section">
              <div className="section-head">
                <h2>턴 타임라인</h2>
                <span className="meta">{turns.length}턴 전체</span>
              </div>
              <div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "32px 70px 1fr 90px 70px 80px",
                  gap: 12, padding: "8px 0",
                  borderBottom: "1px solid var(--line-hair)",
                  fontFamily: "var(--font-mono)", fontSize: 10,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                  color: "var(--ink-3)",
                }}>
                  <span>#</span>
                  <span>시각</span>
                  <span>요약</span>
                  <span style={{ textAlign: "right" }}>비용</span>
                  <span style={{ textAlign: "right" }}>토큰</span>
                  <span style={{ textAlign: "right" }}>임팩트</span>
                </div>

                {turns.map((t, i) => (
                  <div key={t.id} style={{
                    display: "grid",
                    gridTemplateColumns: "32px 70px 1fr 90px 70px 80px",
                    gap: 12, padding: "14px 0",
                    borderBottom: "1px solid var(--line-hair)",
                    alignItems: "center", fontSize: 13,
                  }}>
                    <span className="mono" style={{ color: "var(--ink-4)", fontSize: 11 }}>T{i + 1}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{fmtTimeShort(t.ts)}</span>
                    <div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)" }}>
                        {t.model && <span style={{ color: "var(--ink-4)" }}>{t.model.replace("claude-", "")}</span>}
                        {(t.tool_calls ?? 0) > 0 && <span>{t.tool_calls} tools</span>}
                        {(t.edit_calls ?? 0) > 0 && <span>{t.edit_calls} edits</span>}
                        {(t.agent_spawned ?? 0) > 0 && <span style={{ color: "var(--acc-ink)" }}>{t.agent_spawned} agents</span>}
                        {(t.error_count ?? 0) > 0 && <span style={{ color: "var(--bad)" }}>↑ {t.error_count} err</span>}
                      </div>
                      {t.file_exts && Object.keys(t.file_exts).length > 0 && (
                        <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {Object.entries(t.file_exts).map(([ext, cnt]) => (
                            <span key={ext} className="chip" style={{ fontSize: 10 }}>{ext} ×{cnt}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="mono tnum" style={{ textAlign: "right", fontSize: 12 }}>{fmtCost(t.cost_usd)}</span>
                    <span className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)", fontSize: 12 }}>
                      {fmtK((t.tokens_input ?? 0) + (t.tokens_output ?? 0))}
                    </span>
                    <div style={{ textAlign: "right" }}>
                      {t.impact_score != null
                        ? <span className={`chip ${t.impact_score >= 4 ? "acc" : ""}`}>{t.impact_score}/5</span>
                        : <span style={{ color: "var(--ink-5)", fontSize: 12 }}>—</span>}
                    </div>
                  </div>
                ))}

                {turns.length === 0 && (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    턴 없음
                  </div>
                )}
              </div>
            </div>

            {lastImpactTurn?.impact_note && (
              <div className="section">
                <div className="section-head">
                  <h2>임팩트 메모</h2>
                  <span className="meta">{lastImpactTurn.impact_score != null ? `${lastImpactTurn.impact_score}/5` : ""}</span>
                </div>
                <blockquote style={{
                  margin: 0, padding: "20px 24px",
                  background: "var(--bg-2)", borderLeft: "3px solid var(--ink)",
                  fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.5, color: "var(--ink-2)",
                }}>
                  "{lastImpactTurn.impact_note}"
                </blockquote>
              </div>
            )}
          </>
        )}

        {/* ── 컨텍스트 탭 ── */}
        {tab === "context" && (
          <>
            {/* 토큰 예산 미터 */}
            <div className="section">
              <div className="section-head">
                <h2>토큰 분포</h2>
                <span className="meta">세션 전체 합계</span>
              </div>

              {totalAllTokens > 0 ? (
                <>
                  {/* 스택 바 */}
                  <div style={{ height: 28, display: "flex", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
                    {[
                      { label: "입력", tokens: totalInput, color: "oklch(0.65 0.14 260)" },
                      { label: "캐시 읽기", tokens: totalCacheRead, color: "oklch(0.60 0.18 145)" },
                      { label: "캐시 생성", tokens: totalCacheCreate, color: "oklch(0.80 0.14 145)" },
                      { label: "출력", tokens: totalOutput, color: "oklch(0.70 0.12 55)" },
                    ].filter((s) => s.tokens > 0).map((seg) => (
                      <div key={seg.label}
                        title={`${seg.label}: ${fmtNum(seg.tokens)}`}
                        style={{
                          width: `${(seg.tokens / totalAllTokens) * 100}%`,
                          background: seg.color,
                          minWidth: seg.tokens > 0 ? 2 : 0,
                        }}
                      />
                    ))}
                  </div>

                  {/* 범례 */}
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {[
                      { label: "입력", tokens: totalInput, color: "oklch(0.65 0.14 260)" },
                      { label: "캐시 읽기", tokens: totalCacheRead, color: "oklch(0.60 0.18 145)" },
                      { label: "캐시 생성", tokens: totalCacheCreate, color: "oklch(0.80 0.14 145)" },
                      { label: "출력", tokens: totalOutput, color: "oklch(0.70 0.12 55)" },
                    ].map((seg) => (
                      <span key={seg.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, display: "inline-block" }} />
                        <span style={{ color: "var(--ink-3)" }}>{seg.label}</span>
                        <span style={{ color: "var(--ink-2)" }}>{fmtK(seg.tokens)}</span>
                        <span style={{ color: "var(--ink-4)" }}>({totalAllTokens > 0 ? ((seg.tokens / totalAllTokens) * 100).toFixed(0) : 0}%)</span>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ padding: "24px 0", color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  토큰 데이터 없음
                </div>
              )}
            </div>

            {/* 턴별 토큰 분포 테이블 */}
            <div className="section">
              <div className="section-head">
                <h2>턴별 토큰 분포</h2>
                <span className="meta">{turns.length}턴</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th style={{ width: 70 }}>시각</th>
                    <th style={{ textAlign: "right" }}>입력</th>
                    <th style={{ textAlign: "right" }}>캐시 읽기</th>
                    <th style={{ textAlign: "right" }}>캐시 생성</th>
                    <th style={{ textAlign: "right" }}>출력</th>
                    <th style={{ textAlign: "right" }}>캐시율</th>
                  </tr>
                </thead>
                <tbody>
                  {turns.map((t, i) => (
                    <tr key={t.id}>
                      <td className="mono" style={{ color: "var(--ink-4)", fontSize: 11 }}>T{i + 1}</td>
                      <td className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{fmtTimeShort(t.ts)}</td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>{fmtK(t.tokens_input)}</td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "oklch(0.55 0.18 145)" }}>{fmtK(t.tokens_cache_read)}</td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "oklch(0.65 0.12 145)" }}>{fmtK(t.tokens_cache_creation)}</td>
                      <td className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)" }}>{fmtK(t.tokens_output)}</td>
                      <td className="mono tnum" style={{ textAlign: "right" }}>
                        {t.cache_hit_rate != null
                          ? <span style={{ color: t.cache_hit_rate > 0.5 ? "oklch(0.55 0.18 145)" : "var(--ink-3)" }}>
                              {(t.cache_hit_rate * 100).toFixed(0)}%
                            </span>
                          : <span style={{ color: "var(--ink-5)" }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 편집 파일 목록 */}
            {fileExts.length > 0 && (
              <div className="section">
                <div className="section-head">
                  <h2>편집 파일 확장자</h2>
                  <span className="meta">편집 수 기준</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {fileExts.map(({ ext, count }) => {
                    const pct = (count / (fileExts[0]?.count ?? 1)) * 100;
                    return (
                      <div key={ext} style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--font-mono)" }}>
                        <span style={{ width: 60, fontSize: 12, color: "var(--ink-2)" }}>{ext}</span>
                        <div style={{ flex: 1, height: 10, background: "var(--bg-2)", borderRadius: 2 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "var(--ink-3)", borderRadius: 2 }} />
                        </div>
                        <span style={{ width: 32, textAlign: "right", fontSize: 12, color: "var(--ink-3)" }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Harness 탭 ── */}
        {tab === "harness" && (
          <>
            {/* 런타임 정보 */}
            <div className="section">
              <div className="section-head">
                <h2>런타임 정보</h2>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                {[
                  { label: "디바이스", value: meta!.device_alias ?? meta!.device_id.slice(0, 8) },
                  { label: "호스트명", value: meta!.device_hostname ?? "—" },
                  { label: "OS", value: meta!.device_os ?? "—" },
                  { label: "클라이언트 버전", value: meta!.device_client_version ? `v${meta!.device_client_version}` : "—" },
                  { label: "사용 모델", value: models.length > 0 ? models.map((m) => m?.replace("claude-", "")).join(", ") : "—" },
                  { label: "세션 ID", value: id },
                ].map(({ label, value }) => (
                  <div key={label} style={{ padding: "14px 0", borderBottom: "1px solid var(--line-hair)", display: "flex", gap: 16, alignItems: "baseline" }}>
                    <span style={{ width: 140, flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {label}
                    </span>
                    <span className="mono" style={{ fontSize: 13, color: "var(--ink-2)", wordBreak: "break-all" }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 세션 통계 */}
            <div className="section">
              <div className="section-head">
                <h2>세션 통계</h2>
              </div>
              <div className="stat-grid stat-grid-4">
                {[
                  { label: "총 턴", value: String(meta!.total_turns) },
                  { label: "총 비용", value: fmtCost(meta!.total_cost_usd) },
                  { label: "에러 수", value: String(totalErrors) },
                  { label: "에이전트 위임", value: String(totalAgents) },
                  { label: "총 편집", value: String(turns.reduce((s, t) => s + (t.edit_calls ?? 0), 0)) },
                  { label: "총 도구 호출", value: String(turns.reduce((s, t) => s + (t.tool_calls ?? 0), 0)) },
                  { label: "소요 시간", value: fmtDuration(meta!.duration_s) },
                  { label: "캐시 절약", value: totalCacheRead > 0 ? `~${fmtK(totalCacheRead)} tok` : "—" },
                ].map((item) => (
                  <div key={item.label} className="stat-grid-item">
                    <div className="label" style={{ marginBottom: 8 }}>{item.label}</div>
                    <div className="stat-num tnum xs">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 도구 활동 */}
            <div className="section">
              <div className="section-head">
                <h2>도구 활동 타임라인</h2>
                <span className="meta">턴별 tool_calls · edit_calls</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {turns.map((t, i) => {
                  const tc = t.tool_calls ?? 0;
                  const ec = t.edit_calls ?? 0;
                  const ag = t.agent_spawned ?? 0;
                  const er = t.error_count ?? 0;
                  return (
                    <div key={t.id} style={{
                      display: "flex", alignItems: "center", gap: 12,
                      fontFamily: "var(--font-mono)", fontSize: 12,
                    }}>
                      <span style={{ width: 36, color: "var(--ink-4)" }}>T{i + 1}</span>
                      <span style={{ width: 64, color: "var(--ink-3)" }}>{fmtTimeShort(t.ts)}</span>
                      <div style={{ flex: 1, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {tc > 0 && (
                          <span className="chip" style={{ fontSize: 10 }}>🔧 {tc}</span>
                        )}
                        {ec > 0 && (
                          <span className="chip" style={{ fontSize: 10 }}>✏️ {ec}</span>
                        )}
                        {ag > 0 && (
                          <span className="chip acc" style={{ fontSize: 10 }}>⇂ {ag}</span>
                        )}
                        {er > 0 && (
                          <span className="chip bad" style={{ fontSize: 10 }}>⚠ {er}</span>
                        )}
                        {tc === 0 && ec === 0 && ag === 0 && er === 0 && (
                          <span style={{ color: "var(--ink-5)" }}>idle</span>
                        )}
                      </div>
                      {t.model && (
                        <span style={{ color: "var(--ink-4)", fontSize: 11 }}>
                          {t.model.replace("claude-", "")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
