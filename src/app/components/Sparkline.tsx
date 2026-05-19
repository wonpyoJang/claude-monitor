"use client";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

export type SparkPoint = { day: string; value: number };

export default function Sparkline({ data }: { data: SparkPoint[] }) {
  if (!data || data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={32}>
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--acc)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--line-hair)",
            borderRadius: 3,
            fontSize: 10,
            padding: "2px 6px",
          }}
          formatter={(v) => [`$${Number(v).toFixed(4)}/turn`, "cost/turn"] as [string, string]}
          labelFormatter={() => ""}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
