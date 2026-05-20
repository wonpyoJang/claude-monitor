import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";

export default async function CoachStripe() {
  const auth = await getSession();
  if (!auth) return null;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let insight: { type: string; title: string; metric: string } | null = null;

  try {
    const { rows } = await pool.query<{
      error_rate_7d: string; error_rate_prev: string;
      cache_7d: string; cache_prev: string;
      cpt_7d: string; cpt_prev: string;
      turns_7d: string;
      impact45_7d: string; impact_total_7d: string;
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
        COUNT(CASE WHEN t.ts >= NOW()-'7 days'::interval AND t.impact_score >= 4 THEN 1 END)::text AS impact45_7d,
        COUNT(CASE WHEN t.ts >= NOW()-'7 days'::interval AND t.impact_score IS NOT NULL THEN 1 END)::text AS impact_total_7d
       FROM devices d JOIN turns t ON t.device_id = d.id
       WHERE d.user_id = $1`,
      [auth.sub]
    );

    const p = rows[0];
    if (!p) return null;

    const errRate = Number(p.error_rate_7d);
    const errPrev = Number(p.error_rate_prev);
    const cache7d = Number(p.cache_7d);
    const cachePrev = Number(p.cache_prev);
    const cpt7d = Number(p.cpt_7d);
    const cptPrev = Number(p.cpt_prev);
    const turns7d = Number(p.turns_7d);
    const impact45 = Number(p.impact45_7d);
    const impactTotal = Number(p.impact_total_7d);

    if (turns7d < 5) return null;

    if (errRate > 0.1 && errRate > errPrev * 1.2) {
      insight = { type: "priority", title: "오류율 급등", metric: `${(errRate * 100).toFixed(1)}%` };
    } else if (cachePrev > 0 && cache7d < cachePrev * 0.85) {
      insight = { type: "warning", title: "캐시 적중률 하락", metric: `${(cache7d * 100).toFixed(0)}% (이전 ${(cachePrev * 100).toFixed(0)}%)` };
    } else if (errRate > 0.1) {
      insight = { type: "warning", title: "오류율 높음", metric: `${(errRate * 100).toFixed(1)}%` };
    } else if (cptPrev > 0 && cpt7d > cptPrev * 1.15) {
      insight = { type: "observation", title: "턴당 비용 증가", metric: `$${cpt7d.toFixed(4)} (+${(((cpt7d - cptPrev) / cptPrev) * 100).toFixed(0)}%)` };
    } else if (impactTotal >= 5 && impact45 / impactTotal >= 0.4) {
      insight = { type: "win", title: "높은 임팩트 세션", metric: `${((impact45 / impactTotal) * 100).toFixed(0)}% 고임팩트` };
    }
  } finally {
    await pool.end();
  }

  if (!insight) return null;

  const colors: Record<string, { bg: string; color: string; dot: string }> = {
    priority:    { bg: "var(--bad-bg)",                        color: "var(--bad)",              dot: "var(--bad)" },
    warning:     { bg: "oklch(0.97 0.04 80)",                  color: "oklch(0.55 0.18 55)",     dot: "oklch(0.72 0.18 55)" },
    observation: { bg: "var(--bg-2)",                          color: "var(--ink-3)",             dot: "var(--ink-4)" },
    win:         { bg: "oklch(0.96 0.05 145)",                 color: "oklch(0.40 0.18 145)",    dot: "oklch(0.55 0.18 145)" },
  };
  const c = colors[insight.type] ?? colors.observation;

  return (
    <a href="/coach" style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 16px",
      marginBottom: 32,
      background: c.bg,
      borderRadius: 6,
      textDecoration: "none",
      border: "1px solid " + c.dot + "33",
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: c.dot, flexShrink: 0,
      }} />
      <span style={{ fontSize: 13, color: c.color, fontWeight: 600 }}>{insight.title}</span>
      <span style={{ fontSize: 13, color: c.color, opacity: 0.8, fontFamily: "var(--font-mono)" }}>
        {insight.metric}
      </span>
      <span style={{ marginLeft: "auto", fontSize: 12, color: c.color, opacity: 0.7 }}>
        코치 보기 →
      </span>
    </a>
  );
}
