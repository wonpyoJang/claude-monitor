import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Topbar from "@/app/Topbar";

export const dynamic = "force-dynamic";

type InsightType = "priority" | "warning" | "observation" | "win";

type Insight = {
  type: InsightType;
  title: string;
  metric: string;
  body: string;
  effect: string;
};

const TYPE_META: Record<InsightType, { label: string; color: string; bg: string }> = {
  priority: { label: "⚡ 우선순위", color: "var(--bad)", bg: "var(--bad-bg)" },
  warning:  { label: "⚠️ 경고",    color: "oklch(0.72 0.18 55)", bg: "oklch(0.97 0.04 80)" },
  win:      { label: "🎉 성과",    color: "oklch(0.55 0.18 145)", bg: "oklch(0.96 0.05 145)" },
  observation: { label: "💡 관찰", color: "var(--ink-3)", bg: "var(--bg-2)" },
};

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: filterParam } = await searchParams;
  const filter = ["warning", "win"].includes(filterParam ?? "") ? (filterParam as string) : "all";

  const auth = await getSession();
  if (!auth) redirect("/login");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const insights: Insight[] = [];

  try {
    // 1. 현재 7일 vs 이전 7일 기본 지표
    const { rows: periodRows } = await pool.query<{
      error_rate_7d: string; error_rate_prev: string;
      cache_7d: string; cache_prev: string;
      cpt_7d: string; cpt_prev: string;
      turns_7d: string; turns_prev: string;
      impact45_7d: string; impact_total_7d: string;
      impact45_prev: string; impact_total_prev: string;
    }>(
      `SELECT
        COALESCE(SUM(CASE WHEN t.ts >= NOW()-'7 days'::interval THEN t.error_count ELSE 0 END)::float
          / NULLIF(SUM(CASE WHEN t.ts >= NOW()-'7 days'::interval THEN t.tool_calls ELSE 0 END), 0), 0)::text AS error_rate_7d,
        COALESCE(SUM(CASE WHEN t.ts < NOW()-'7 days'::interval AND t.ts >= NOW()-'14 days'::interval THEN t.error_count ELSE 0 END)::float
          / NULLIF(SUM(CASE WHEN t.ts < NOW()-'7 days'::interval AND t.ts >= NOW()-'14 days'::interval THEN t.tool_calls ELSE 0 END), 0), 0)::text AS error_rate_prev,
        COALESCE(AVG(CASE WHEN t.ts >= NOW()-'7 days'::interval THEN t.cache_hit_rate END), 0)::text AS cache_7d,
        COALESCE(AVG(CASE WHEN t.ts < NOW()-'7 days'::interval AND t.ts >= NOW()-'14 days'::interval THEN t.cache_hit_rate END), 0)::text AS cache_prev,
        COALESCE(SUM(CASE WHEN t.ts >= NOW()-'7 days'::interval THEN t.cost_usd ELSE 0 END)::float
          / NULLIF(COUNT(CASE WHEN t.ts >= NOW()-'7 days'::interval THEN 1 END), 0), 0)::text AS cpt_7d,
        COALESCE(SUM(CASE WHEN t.ts < NOW()-'7 days'::interval AND t.ts >= NOW()-'14 days'::interval THEN t.cost_usd ELSE 0 END)::float
          / NULLIF(COUNT(CASE WHEN t.ts < NOW()-'7 days'::interval AND t.ts >= NOW()-'14 days'::interval THEN 1 END), 0), 0)::text AS cpt_prev,
        COUNT(CASE WHEN t.ts >= NOW()-'7 days'::interval THEN 1 END)::text AS turns_7d,
        COUNT(CASE WHEN t.ts < NOW()-'7 days'::interval AND t.ts >= NOW()-'14 days'::interval THEN 1 END)::text AS turns_prev,
        COUNT(CASE WHEN t.ts >= NOW()-'7 days'::interval AND t.impact_score >= 4 THEN 1 END)::text AS impact45_7d,
        COUNT(CASE WHEN t.ts >= NOW()-'7 days'::interval AND t.impact_score IS NOT NULL THEN 1 END)::text AS impact_total_7d,
        COUNT(CASE WHEN t.ts < NOW()-'7 days'::interval AND t.ts >= NOW()-'14 days'::interval AND t.impact_score >= 4 THEN 1 END)::text AS impact45_prev,
        COUNT(CASE WHEN t.ts < NOW()-'7 days'::interval AND t.ts >= NOW()-'14 days'::interval AND t.impact_score IS NOT NULL THEN 1 END)::text AS impact_total_prev
       FROM devices d JOIN turns t ON t.device_id = d.id
       WHERE d.user_id = $1`,
      [auth.sub]
    );

    const p = periodRows[0];
    const errRate7d  = Number(p?.error_rate_7d ?? 0);
    const errRatePrev = Number(p?.error_rate_prev ?? 0);
    const cache7d    = Number(p?.cache_7d ?? 0);
    const cachePrev  = Number(p?.cache_prev ?? 0);
    const cpt7d      = Number(p?.cpt_7d ?? 0);
    const cptPrev    = Number(p?.cpt_prev ?? 0);
    const turns7d    = Number(p?.turns_7d ?? 0);
    const impact45_7d = Number(p?.impact45_7d ?? 0);
    const impactTotal7d = Number(p?.impact_total_7d ?? 0);
    const impact45Prev  = Number(p?.impact45_prev ?? 0);
    const impactTotalPrev = Number(p?.impact_total_prev ?? 0);

    // 2. 에러 클러스터: 최근 세션 중 연속 에러 3턴+ 세션 탐지
    const { rows: clusterRows } = await pool.query<{ session_id: string; cluster_count: string }>(
      `SELECT t.session_id, COUNT(*)::text AS cluster_count
       FROM turns t
       JOIN devices d ON d.id = t.device_id
       WHERE d.user_id = $1
         AND t.ts >= NOW()-'7 days'::interval
         AND t.error_count > 0
       GROUP BY t.session_id
       HAVING COUNT(*) >= 3`,
      [auth.sub]
    );

    // 3. 비용 급등 세션 (평균 2배 초과)
    const { rows: spikeRows } = await pool.query<{ session_id: string; cwd: string | null; cpt: string }>(
      `WITH avg_cpt AS (
         SELECT COALESCE(SUM(t.cost_usd)::float / NULLIF(COUNT(t.id), 0), 0) AS avg
         FROM devices d JOIN turns t ON t.device_id = d.id
         WHERE d.user_id = $1 AND t.ts >= NOW()-'30 days'::interval
       ),
       session_cpt AS (
         SELECT s.id AS session_id, s.cwd,
           COALESCE(SUM(t.cost_usd)::float / NULLIF(COUNT(t.id), 0), 0)::text AS cpt
         FROM sessions s
         JOIN devices d ON d.id = s.device_id
         JOIN turns t ON t.session_id = s.id
         WHERE d.user_id = $1 AND t.ts >= NOW()-'7 days'::interval
         GROUP BY s.id, s.cwd
       )
       SELECT sc.session_id, sc.cwd, sc.cpt
       FROM session_cpt sc, avg_cpt a
       WHERE sc.cpt::float > a.avg * 2 AND a.avg > 0
       LIMIT 3`,
      [auth.sub]
    );

    // ─── 인사이트 생성 ───

    // 에러율 경고
    if (errRate7d > 0.1) {
      insights.push({
        type: errRate7d > errRatePrev * 1.2 ? "priority" : "warning",
        title: "오류율 높음",
        metric: `오류율 ${(errRate7d * 100).toFixed(1)}% (이전 7일 ${(errRatePrev * 100).toFixed(1)}%)`,
        body: `도구 호출 10회 중 ${Math.round(errRate7d * 10)}회 이상 오류가 발생하고 있습니다. 반복되는 도구 에러나 잘못된 파라미터 패턴을 확인하세요.`,
        effect: "오류 감소 시 턴당 비용 최대 20% 절감 가능",
      });
    }

    // 에러 클러스터 세션
    if (clusterRows.length > 0) {
      insights.push({
        type: "warning",
        title: `에러 집중 세션 ${clusterRows.length}건 감지`,
        metric: `최근 7일 내 연속 에러 3턴+ 세션 ${clusterRows.length}개`,
        body: "특정 세션에서 에러가 연속 발생했습니다. 해당 세션의 프롬프트 패턴이나 컨텍스트를 점검하세요.",
        effect: "클러스터 세션 해소 시 전체 오류율 개선",
      });
    }

    // 캐시율 하락
    if (cachePrev > 0 && cache7d < cachePrev * 0.85) {
      insights.push({
        type: "warning",
        title: "캐시 적중률 하락",
        metric: `캐시율 ${(cache7d * 100).toFixed(0)}% → ${(cachePrev * 100).toFixed(0)}% (이전 7일)`,
        body: "캐시 적중률이 이전 주 대비 15% 이상 떨어졌습니다. 컨텍스트 크기가 줄었거나, 프롬프트 패턴이 변경된 경우 발생합니다.",
        effect: "캐시율 회복 시 토큰 비용 최대 30% 절감",
      });
    }

    // 비용 급등 세션
    if (spikeRows.length > 0) {
      const cwd = spikeRows[0].cwd?.split("/").slice(-2).join("/") ?? "unknown";
      insights.push({
        type: "priority",
        title: "턴당 비용 급등 세션",
        metric: `${spikeRows.length}개 세션이 평균 비용의 2배 초과 (예: …/${cwd})`,
        body: "특정 세션에서 턴당 비용이 비정상적으로 높습니다. 컨텍스트 초기화 없이 긴 대화가 이어지거나 대형 파일을 반복 읽는 패턴을 확인하세요.",
        effect: "컨텍스트 관리 개선 시 해당 세션 비용 50% 이상 절감 가능",
      });
    }

    // 비용 증가 관찰
    if (cptPrev > 0 && cpt7d > cptPrev * 1.15) {
      insights.push({
        type: "observation",
        title: "턴당 비용 증가 추세",
        metric: `턴당 비용 $${cpt7d.toFixed(4)} (이전 7일 $${cptPrev.toFixed(4)}, +${(((cpt7d - cptPrev) / cptPrev) * 100).toFixed(0)}%)`,
        body: "턴당 비용이 이전 주보다 15% 이상 증가했습니다. 더 복잡한 작업을 처리 중이거나, 컨텍스트 길이가 늘어난 경우입니다.",
        effect: "캐시 전략 최적화로 비용 안정화 가능",
      });
    }

    // 낮은 캐시율 관찰
    if (cache7d > 0 && cache7d < 0.3 && cachePrev <= 0) {
      insights.push({
        type: "observation",
        title: "캐시 적중률 낮음",
        metric: `캐시율 ${(cache7d * 100).toFixed(0)}% (권장 50%+)`,
        body: "캐시 적중률이 낮습니다. 짧은 세션이 많거나, 매 턴마다 컨텍스트가 크게 달라지는 경우 발생합니다.",
        effect: "세션당 평균 대화 길이 증가 시 캐시 효율 자연 상승",
      });
    }

    // 임팩트 Win 카드
    if (impactTotal7d >= 5) {
      const ratio7d = impact45_7d / impactTotal7d;
      const ratioPrev = impactTotalPrev > 0 ? impact45Prev / impactTotalPrev : 0;
      if (ratio7d >= 0.4) {
        insights.push({
          type: "win",
          title: "높은 임팩트 세션 비율",
          metric: `임팩트 4·5점 비율 ${(ratio7d * 100).toFixed(0)}% (${impact45_7d}/${impactTotal7d}턴)`,
          body: `최근 7일 평가된 턴 중 ${(ratio7d * 100).toFixed(0)}%가 높은 임팩트(4~5점)를 기록했습니다. 생산적인 작업 세션이 이어지고 있습니다.`,
          effect: "현재 워크플로우를 유지하면 장기적으로 높은 ROI 달성",
        });
      } else if (ratioPrev > 0 && ratio7d > ratioPrev * 1.1) {
        insights.push({
          type: "win",
          title: "임팩트 점수 상승",
          metric: `임팩트 4·5점 비율 ${(ratioPrev * 100).toFixed(0)}% → ${(ratio7d * 100).toFixed(0)}%`,
          body: "이전 주 대비 높은 임팩트 세션 비율이 증가했습니다. 에이전트 활용 패턴이 개선되고 있습니다.",
          effect: "임팩트 상승 추세 유지 시 장기 효율성 향상",
        });
      }
    }

    // 충분한 사용 데이터 없는 경우
    if (turns7d < 10) {
      insights.push({
        type: "observation",
        title: "데이터 수집 중",
        metric: `최근 7일 ${turns7d}턴 기록됨 (분석 최소 10턴)`,
        body: "Claude Code를 더 사용할수록 인사이트가 정확해집니다. Stop Hook이 활성화되어 있는지 확인하세요.",
        effect: "10턴 이상 누적 시 전체 분석 활성화",
      });
    }
  } finally {
    await pool.end();
  }

  const filtered =
    filter === "all"
      ? insights
      : filter === "warning"
      ? insights.filter((i) => i.type === "warning" || i.type === "priority")
      : insights.filter((i) => i.type === "win");

  const tabs = [
    { id: "all", label: "전체" },
    { id: "warning", label: "경고" },
    { id: "win", label: "성과" },
  ];

  return (
    <>
      <Topbar />
      <main className="page">
        <div className="breadcrumb">
          <a href="/">대시보드</a>
          <span className="sep">/</span>
          <span>코치</span>
        </div>

        <div style={{ marginBottom: 40 }}>
          <div className="label" style={{ marginBottom: 12 }}>AI 사용 패턴 분석</div>
          <h1 className="page-title">에이전트 코치.</h1>
          <p style={{ color: "var(--ink-3)", fontSize: 14, marginTop: 8 }}>
            지난 7일 데이터 기반 자동 인사이트 — {insights.length}개 발견
          </p>
        </div>

        {/* 탭 필터 */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line-hair)", marginBottom: 32 }}>
          {tabs.map((t) => (
            <a key={t.id} href={`/coach?filter=${t.id}`}
              style={{
                padding: "10px 14px", fontSize: 13, display: "block",
                color: filter === t.id ? "var(--ink)" : "var(--ink-3)",
                borderBottom: "2px solid " + (filter === t.id ? "var(--ink)" : "transparent"),
                marginBottom: -1, fontWeight: 500, textDecoration: "none",
              }}>
              {t.label}
            </a>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
            해당 유형의 인사이트가 없습니다.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {filtered.map((ins, i) => {
              const meta = TYPE_META[ins.type];
              return (
                <div key={i} style={{
                  border: "1px solid var(--line-soft)",
                  borderRadius: 8,
                  padding: "20px 24px",
                  background: "var(--surface)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      color: meta.color,
                      background: meta.bg,
                      fontFamily: "var(--font-mono)",
                    }}>
                      {meta.label}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{ins.title}</span>
                  </div>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--ink-3)",
                    marginBottom: 10,
                    padding: "6px 10px",
                    background: "var(--bg-2)",
                    borderRadius: 4,
                  }}>
                    {ins.metric}
                  </div>
                  <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6, marginBottom: 12 }}>
                    {ins.body}
                  </p>
                  <div style={{ fontSize: 12, color: "oklch(0.55 0.18 145)", fontFamily: "var(--font-mono)" }}>
                    ↗ {ins.effect}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 40, padding: "16px 0", borderTop: "1px solid var(--line-hair)", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-4)" }}>
          규칙 기반 분석 · 최근 7일 데이터 기준 · 매 방문 시 재계산
        </div>
      </main>
    </>
  );
}
