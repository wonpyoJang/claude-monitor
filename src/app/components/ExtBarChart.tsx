"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

type Item = { ext: string; edits: number; cost: number };

const TICK_STYLE = { fontSize: 10, fill: "var(--ink-4, #a09a89)" };

export default function ExtBarChart({ data }: { data: Item[] }) {
  if (!data || data.length === 0) return null;
  const maxEdits = Math.max(...data.map((d) => Number(d.edits)), 1);
  return (
    <ResponsiveContainer width="100%" height={data.length * 28 + 16}>
      <BarChart
        data={data.map((d) => ({ ...d, edits: Number(d.edits) }))}
        layout="vertical"
        margin={{ top: 0, right: 40, left: 32, bottom: 0 }}
      >
        <XAxis type="number" tick={TICK_STYLE} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="ext"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--line-hair)",
            borderRadius: 3,
            fontSize: 11,
          }}
          formatter={(v) => [Number(v).toLocaleString(), "편집 수"] as [string, string]}
        />
        <Bar dataKey="edits" radius={[0, 2, 2, 0]} maxBarSize={16}>
          {data.map((d, i) => (
            <Cell
              key={d.ext}
              fill={`oklch(${0.62 - i * 0.025} 0.09 145)`}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
