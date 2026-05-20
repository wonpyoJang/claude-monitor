"use client";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from "recharts";

export type WeeklyImpactPoint = {
  week: string;
  score1: number;
  score2: number;
  score3: number;
  score4: number;
  score5: number;
  avgScore: number | null;
};

const TICK_STYLE = { fontSize: 10, fill: "var(--ink-4)" };
const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--line-hair)",
  borderRadius: 3,
  fontSize: 11,
  color: "var(--ink)",
};

const SCORE_COLORS = [
  "oklch(0.72 0.06 30)",  // 1 — 낮음
  "oklch(0.70 0.08 60)",  // 2
  "oklch(0.68 0.09 100)", // 3
  "oklch(0.60 0.11 200)", // 4
  "oklch(0.50 0.13 295)", // 5 — 높음
];

export default function WeeklyImpactCharts({ data }: { data: WeeklyImpactPoint[] }) {
  if (data.length === 0) {
    return (
      <div style={{ color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 13, paddingTop: 24 }}>
        주간 데이터 없음
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
      {/* 주별 impact 분포 세로 막대 차트 */}
      <div>
        <div className="label" style={{ marginBottom: 12 }}>주별 임팩트 분포 (최근 12주)</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--line-hair)" vertical={false} />
            <XAxis dataKey="week" tick={TICK_STYLE} tickLine={false} axisLine={false} />
            <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "var(--ink-3)" }}
              formatter={(v, name) => [Number(v), `${name}점`]}
            />
            <Legend
              iconType="square" iconSize={8}
              wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
              formatter={(v) => `${v}점`}
            />
            {[1, 2, 3, 4, 5].map((sc, i) => (
              <Bar
                key={sc}
                dataKey={`score${sc}`}
                name={String(sc)}
                stackId="a"
                fill={SCORE_COLORS[i]}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 평균 impact 추세 라인 */}
      <div>
        <div className="label" style={{ marginBottom: 12 }}>주간 평균 임팩트 점수</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--line-hair)" />
            <XAxis dataKey="week" tick={TICK_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              tick={TICK_STYLE} tickLine={false} axisLine={false}
              domain={[0, 5]} ticks={[1, 2, 3, 4, 5]}
            />
            <Tooltip
              formatter={(v) => [Number(v).toFixed(2), "평균 임팩트"]}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "var(--ink-3)" }}
            />
            <ReferenceLine
              y={3.5}
              stroke="var(--acc)"
              strokeDasharray="3 3"
              label={{ value: "목표 3.5", fontSize: 9, fill: "var(--acc)", position: "insideTopRight" }}
            />
            <Line
              type="monotone" dataKey="avgScore"
              stroke="var(--ink)" strokeWidth={1.5} dot={{ r: 3 }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
