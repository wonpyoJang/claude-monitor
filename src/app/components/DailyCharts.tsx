"use client";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

export type DailyPoint = { day: string; cost: number; turns: number };

const TICK_STYLE = { fontSize: 10, fill: "var(--ink-4, #a09a89)" };
const TOOLTIP_STYLE = {
  background: "var(--surface, #fefdfa)",
  border: "1px solid var(--line-hair, rgba(26,25,22,0.08))",
  borderRadius: 3, fontSize: 11,
  color: "var(--ink, #1a1916)",
};

export default function DailyCharts({ data }: { data: DailyPoint[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
      <div>
        <div className="label" style={{ marginBottom: 12 }}>일별 비용</div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--line-hair, rgba(26,25,22,0.08))" />
            <XAxis
              dataKey="day"
              tick={TICK_STYLE}
              tickLine={false} axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={TICK_STYLE}
              tickLine={false} axisLine={false}
              tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
            />
            <Tooltip
              formatter={(v) => [`$${Number(v).toFixed(4)}`, "비용"]}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "var(--ink-3)" }}
            />
            <Line
              type="monotone" dataKey="cost"
              stroke="var(--ink, #1a1916)"
              strokeWidth={1.5} dot={false}
              activeDot={{ r: 3, fill: "var(--ink, #1a1916)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="label" style={{ marginBottom: 12 }}>일별 턴 수</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--line-hair, rgba(26,25,22,0.08))" />
            <XAxis
              dataKey="day"
              tick={TICK_STYLE}
              tickLine={false} axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              formatter={(v) => [Number(v), "턴"]}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "var(--ink-3)" }}
            />
            <Bar
              dataKey="turns"
              fill="var(--ink-4, #a09a89)"
              radius={[2, 2, 0, 0]}
              maxBarSize={20}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
