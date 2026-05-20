"use client";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, ReferenceDot,
} from "recharts";

export type TurnPoint = {
  idx: number;
  cost: number;
  cumCost: number;
  input: number;
  output: number;
  tools: number;
  edits: number;
  errors: number;
  isExpensive: boolean;
};

export type FileExtData = { ext: string; count: number };

const GRID = "#27272a";
const TICK = { fontSize: 10, fill: "#71717a" };
const TOOLTIP_STYLE = { background: "#18181b", border: "1px solid #3f3f46", fontSize: 11, color: "#e4e4e7" };

export default function TurnCharts({ turns, fileExts }: { turns: TurnPoint[]; fileExts: FileExtData[] }) {
  return (
    <div className="space-y-4 mb-8">
      {/* Cost per turn */}
      <div className="border border-zinc-800 rounded bg-zinc-900 p-4">
        <div className="text-xs text-zinc-400 mb-3">턴별 비용</div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={turns} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="idx" tick={TICK} tickLine={false} axisLine={false} label={{ value: "turn", position: "insideBottomRight", offset: -4, fontSize: 9, fill: "#52525b" }} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toFixed(3)}`} />
            <Tooltip
              formatter={(v) => [`$${Number(v).toFixed(6)}`, "cost"]}
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(l) => `turn #${l}`}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <Line type="monotone" dataKey="cost" stroke="#4ade80" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Cumulative cost timeline */}
      <div className="border border-zinc-800 rounded bg-zinc-900 p-4">
        <div className="text-xs text-zinc-400 mb-3">누적 비용 타임라인 (● 고비용 턴)</div>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={turns} margin={{ top: 16, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="idx" tick={TICK} tickLine={false} axisLine={false} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => `$${Number(v).toFixed(3)}`} />
            <Tooltip
              formatter={(v) => [`$${Number(v).toFixed(6)}`, "누적 비용"]}
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(l) => `turn #${l}`}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <Area type="monotone" dataKey="cumCost" stroke="#4ade80" strokeWidth={1.5} fill="url(#cumGrad)" dot={false} activeDot={{ r: 3 }} />
            {turns.filter((t) => t.isExpensive).map((t) => (
              <ReferenceDot key={t.idx} x={t.idx} y={t.cumCost} r={4} fill="#f87171" stroke="none"
                label={{ value: `T${t.idx}`, position: "top", fontSize: 9, fill: "#f87171" }} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Tokens per turn */}
      <div className="border border-zinc-800 rounded bg-zinc-900 p-4">
        <div className="text-xs text-zinc-400 mb-3">턴별 토큰 (input / output)</div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={turns} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="idx" tick={TICK} tickLine={false} axisLine={false} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
            <Tooltip
              formatter={(v, name) => [Number(v).toLocaleString(), String(name)]}
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(l) => `turn #${l}`}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: "#71717a" }} />
            <Bar dataKey="input" name="input" stackId="a" fill="#6366f1" maxBarSize={20} />
            <Bar dataKey="output" name="output" stackId="a" fill="#f59e0b" maxBarSize={20} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tool activity + file exts side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-zinc-800 rounded bg-zinc-900 p-4">
          <div className="text-xs text-zinc-400 mb-3">툴 활동 (턴별)</div>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={turns} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="idx" tick={TICK} tickLine={false} axisLine={false} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(l) => `turn #${l}`}
                labelStyle={{ color: "#a1a1aa" }}
              />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: "#71717a" }} />
              <Bar dataKey="tools" name="tools" stackId="t" fill="#38bdf8" maxBarSize={20} />
              <Bar dataKey="edits" name="edits" stackId="t" fill="#a78bfa" maxBarSize={20} />
              <Bar dataKey="errors" name="errors" fill="#f87171" maxBarSize={20} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {fileExts.length > 0 && (
          <div className="border border-zinc-800 rounded bg-zinc-900 p-4">
            <div className="text-xs text-zinc-400 mb-3">편집 파일 확장자</div>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={fileExts} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="ext" tick={TICK} tickLine={false} axisLine={false} width={36} />
                <Tooltip
                  formatter={(v) => [Number(v), "edits"]}
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: "#a1a1aa" }}
                />
                <Bar dataKey="count" fill="#34d399" radius={[0, 2, 2, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
