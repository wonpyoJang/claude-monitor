"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export type TrendPoint = { day: string; cost: number; turns: number; cache_hit_rate: number };

type MovingPoint = { day: string; cost_per_turn_7d: number | null; cache_hit_7d: number | null };

function movingAvg(data: TrendPoint[]): MovingPoint[] {
  return data.map((row, i) => {
    const window = data.slice(Math.max(0, i - 6), i + 1);
    const totalCost = window.reduce((s, r) => s + r.cost, 0);
    const totalTurns = window.reduce((s, r) => s + r.turns, 0);
    const avgCache = window.reduce((s, r) => s + r.cache_hit_rate, 0) / window.length;
    return {
      day: row.day,
      cost_per_turn_7d: totalTurns > 0 ? totalCost / totalTurns : null,
      cache_hit_7d: avgCache,
    };
  });
}

const TICK_STYLE = { fontSize: 10, fill: "var(--ink-4, #a09a89)" };
const TOOLTIP_STYLE = {
  background: "var(--surface, #fefdfa)",
  border: "1px solid var(--line-hair, rgba(26,25,22,0.08))",
  borderRadius: 3, fontSize: 11,
  color: "var(--ink, #1a1916)",
};

export default function TrendCharts({ data }: { data: TrendPoint[] }) {
  if (!data || data.length < 2) return null;
  const pts = movingAvg(data);

  // Compare last 7 days vs previous 7 days
  const last7 = pts.slice(-7);
  const prev7 = pts.slice(-14, -7);
  function trendBadge(metric: "cost_per_turn_7d" | "cache_hit_7d", lowerIsBetter: boolean) {
    const curr = last7.map((p) => p[metric]).filter((v): v is number => v != null);
    const prev = prev7.map((p) => p[metric]).filter((v): v is number => v != null);
    if (curr.length === 0 || prev.length === 0) return null;
    const avgCurr = curr.reduce((s, v) => s + v, 0) / curr.length;
    const avgPrev = prev.reduce((s, v) => s + v, 0) / prev.length;
    if (avgPrev === 0) return null;
    const diff = (avgCurr - avgPrev) / avgPrev;
    const improved = lowerIsBetter ? diff < 0 : diff > 0;
    const pct = Math.abs(diff * 100).toFixed(0);
    return { label: `${improved ? "↓" : "↑"} ${pct}% ${improved ? "개선" : "악화"}`, good: improved };
  }

  const costBadge = trendBadge("cost_per_turn_7d", true);
  const cacheBadge = trendBadge("cache_hit_7d", false);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div className="label">7일 이동평균 cost/turn</div>
          {costBadge && (
            <span className={`chip ${costBadge.good ? "acc" : "bad"}`} style={{ fontSize: 10, padding: "1px 6px" }}>
              {costBadge.label}
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={pts} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--line-hair, rgba(26,25,22,0.08))" />
            <XAxis dataKey="day" tick={TICK_STYLE} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={(v) => `$${Number(v).toFixed(4)}`} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v) => [`$${Number(v).toFixed(5)}`, "cost/turn (7d MA)"] as [string, string]}
            />
            <Line type="monotone" dataKey="cost_per_turn_7d" stroke="var(--acc)" strokeWidth={1.5} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div className="label">7일 이동평균 캐시 적중률</div>
          {cacheBadge && (
            <span className={`chip ${cacheBadge.good ? "acc" : "bad"}`} style={{ fontSize: 10, padding: "1px 6px" }}>
              {cacheBadge.label}
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={pts} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--line-hair, rgba(26,25,22,0.08))" />
            <XAxis dataKey="day" tick={TICK_STYLE} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`} domain={[0, 1]} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "cache hit (7d MA)"] as [string, string]}
            />
            <Line type="monotone" dataKey="cache_hit_7d" stroke="oklch(0.55 0.12 295)" strokeWidth={1.5} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
