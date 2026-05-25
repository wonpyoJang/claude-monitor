"use client";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from "recharts";

export type EfficiencyPoint = {
  day: string;
  cacheRate: number | null;
  errorRate: number | null;
};

const GRID = "#27272a";
const TICK = { fontSize: 10, fill: "#71717a" };
const TOOLTIP_STYLE = { background: "#18181b", border: "1px solid #3f3f46", fontSize: 11, color: "#e4e4e7" };

export default function DeviceEfficiencyCharts({ data }: { data: EfficiencyPoint[] }) {
  const filled = data.map((d) => ({
    ...d,
    cacheRate: d.cacheRate ?? undefined,
    errorRate: d.errorRate ?? undefined,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* 캐시 적중률 */}
      <div className="border border-zinc-800 rounded bg-zinc-900 p-4">
        <div className="text-xs text-zinc-400 mb-3">캐시 적중률 (30일)</div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={filled} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="day" tick={TICK} tickLine={false} axisLine={false} interval={6} />
            <YAxis tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              domain={[0, 1]} />
            <Tooltip
              formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "캐시율"]}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "#a1a1aa" }}
            />
            {/* 목표 기준선 50% */}
            <ReferenceLine y={0.5} stroke="#4ade80" strokeDasharray="4 3" strokeOpacity={0.4}
              label={{ value: "목표 50%", position: "right", fontSize: 9, fill: "#4ade80" }} />
            <Line type="monotone" dataKey="cacheRate" stroke="#34d399" strokeWidth={1.5}
              dot={false} activeDot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 에러율 */}
      <div className="border border-zinc-800 rounded bg-zinc-900 p-4">
        <div className="text-xs text-zinc-400 mb-3">에러율 (30일)</div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={filled} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="day" tick={TICK} tickLine={false} axisLine={false} interval={6} />
            <YAxis tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              domain={[0, "dataMax"]} />
            <Tooltip
              formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "에러율"]}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "#a1a1aa" }}
            />
            {/* 주의 기준선 10% */}
            <ReferenceLine y={0.1} stroke="#f87171" strokeDasharray="4 3" strokeOpacity={0.5}
              label={{ value: "주의 10%", position: "right", fontSize: 9, fill: "#f87171" }} />
            <Line type="monotone" dataKey="errorRate" stroke="#f87171" strokeWidth={1.5}
              dot={false} activeDot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
