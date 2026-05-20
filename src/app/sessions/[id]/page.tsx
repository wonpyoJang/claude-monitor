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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await getSession();
  if (!auth) redirect("/login");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let meta: SessionMeta | null = null;
  let turns: TurnRow[] = [];

  try {
    const [metaRes, turnsRes] = await Promise.all([
      pool.query(
        `SELECT s.*, d.alias AS device_alias, d.id AS device_id,
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

  // 차트 데이터 변환
  const turnPoints: TurnPoint[] = turns.map((t, i) => ({
    idx: i + 1,
    cost: Number(t.cost_usd ?? 0),
    input: t.tokens_input ?? 0,
    output: t.tokens_output ?? 0,
    tools: t.tool_calls ?? 0,
    edits: t.edit_calls ?? 0,
    errors: t.error_count ?? 0,
  }));

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

  // 가장 비싼 턴 3개
  const topCostly = [...turns]
    .sort((a, b) => Number(b.cost_usd ?? 0) - Number(a.cost_usd ?? 0))
    .slice(0, 3);

  // 마지막 임팩트 노트
  const lastImpactTurn = [...turns].reverse().find((t) => t.impact_note);

  // 캐시 절약 계산
  const totalCacheRead = turns.reduce((s, t) => s + (t.tokens_cache_read ?? 0), 0);
  const avgCacheHit = turns.length > 0
    ? turns.reduce((s, t) => s + (t.cache_hit_rate ?? 0), 0) / turns.length
    : 0;

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
          {(turns.reduce((s, t) => s + (t.error_count ?? 0), 0)) > 0 && (
            <span className="chip bad">
              {turns.reduce((s, t) => s + (t.error_count ?? 0), 0)} 에러
            </span>
          )}
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
            {
              label: "총 비용",
              value: fmtCost(meta!.total_cost_usd),
              sub: `${meta!.total_turns}턴`,
            },
            {
              label: "입력 · 출력 토큰",
              value: fmtK(Number(meta!.total_input_tokens) + Number(meta!.total_output_tokens)),
              sub: `${fmtK(meta!.total_input_tokens)} in · ${fmtK(meta!.total_output_tokens)} out`,
            },
            {
              label: "캐시 적중률",
              value: avgCacheHit > 0 ? `${(avgCacheHit * 100).toFixed(0)}%` : "—",
              sub: totalCacheRead > 0 ? `캐시 읽기 ${fmtK(totalCacheRead)} tok` : "캐시 없음",
            },
            {
              label: "임팩트",
              value: lastImpactTurn?.impact_score != null ? `${lastImpactTurn.impact_score}/5` : "—",
              sub: lastImpactTurn?.impact_note?.slice(0, 40) ?? "마킹 없음",
            },
          ].map((item, i) => (
            <div key={i} className="stat-grid-item">
              <div className="label" style={{ marginBottom: 8 }}>{item.label}</div>
              <div className="stat-num tnum sm">{item.value}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8 }}>{item.sub}</div>
            </div>
          ))}
        </div>

        {/* 차트 */}
        {turnPoints.length >= 2 && (
          <div className="section">
            <div className="section-head">
              <h2>턴별 차트</h2>
              <span className="meta">{turns.length}턴</span>
            </div>
            <TurnCharts turns={turnPoints} fileExts={fileExts} />
          </div>
        )}

        {/* 가장 비싼 턴 */}
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
                      <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                        {fmtTimeShort(t.ts)}
                      </span>
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

        {/* 턴 타임라인 */}
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
                    {(t.error_count ?? 0) > 0 && (
                      <span style={{ color: "var(--bad)" }}>↑ {t.error_count} err</span>
                    )}
                  </div>
                  {t.file_exts && Object.keys(t.file_exts).length > 0 && (
                    <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {Object.entries(t.file_exts).map(([ext, cnt]) => (
                        <span key={ext} className="chip" style={{ fontSize: 10 }}>{ext} ×{cnt}</span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="mono tnum" style={{ textAlign: "right", fontSize: 12 }}>
                  {fmtCost(t.cost_usd)}
                </span>
                <span className="mono tnum" style={{ textAlign: "right", color: "var(--ink-3)", fontSize: 12 }}>
                  {fmtK((t.tokens_input ?? 0) + (t.tokens_output ?? 0))}
                </span>
                <div style={{ textAlign: "right" }}>
                  {t.impact_score != null ? (
                    <span className={`chip ${t.impact_score >= 4 ? "acc" : ""}`}>
                      {t.impact_score}/5
                    </span>
                  ) : <span style={{ color: "var(--ink-5)", fontSize: 12 }}>—</span>}
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

        {/* 임팩트 노트 */}
        {lastImpactTurn?.impact_note && (
          <div className="section">
            <div className="section-head">
              <h2>임팩트 메모</h2>
              <span className="meta">
                {lastImpactTurn.impact_score != null ? `${lastImpactTurn.impact_score}/5` : ""}
              </span>
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
      </main>
    </>
  );
}
