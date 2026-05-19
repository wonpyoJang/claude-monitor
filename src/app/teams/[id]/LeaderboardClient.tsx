"use client";

import { useEffect, useState, useCallback } from "react";

type MemberRaw = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_emoji: string | null;
  total_cost: string | number;
  total_tokens: string | number;
  cost_per_turn: string | number;
  avg_cache_hit_rate: string | number;
  total_agents: string | number;
  agent_ratio: string | number;
  total_turns: string | number;
};

type Member = {
  id: string;
  email: string;
  display_name: string;
  avatar_emoji: string;
  total_cost: number;
  total_tokens: number;
  cost_per_turn: number;
  avg_cache_hit_rate: number;
  total_agents: number;
  agent_ratio: number;
  total_turns: number;
  composite_score?: number;
};

type Team = { id: string; name: string; invite_code: string };

const PERIODS = [
  { value: "7", label: "7일" },
  { value: "30", label: "30일" },
  { value: "90", label: "90일" },
  { value: "all", label: "전체" },
];

const AWARDS = [
  { key: "total_cost" as const, icon: "💰", label: "Heavy Hitter", desc: "총 비용 1위", higher: true },
  { key: "cost_per_turn" as const, icon: "💡", label: "Most Efficient", desc: "turn당 비용 최저", higher: false },
  { key: "avg_cache_hit_rate" as const, icon: "🎯", label: "Cache Genius", desc: "캐시 히트율 1위", higher: true },
  { key: "total_agents" as const, icon: "🤖", label: "Agent Champion", desc: "에이전트 수 1위", higher: true },
  { key: "total_tokens" as const, icon: "⚡", label: "Token Burner", desc: "총 토큰 1위", higher: true },
  { key: "agent_ratio" as const, icon: "🚀", label: "Automation Rate", desc: "에이전트 비율 1위", higher: true },
] as const;

type MetricKey = (typeof AWARDS)[number]["key"] | "composite_score";

const DEFAULT_WEIGHTS = { cost_per_turn: 30, avg_cache_hit_rate: 25, agent_ratio: 25, contribution: 20 };

function parseMembers(raw: MemberRaw[]): Member[] {
  return raw.map((m) => ({
    id: m.id,
    email: m.email,
    display_name: m.display_name ?? "",
    avatar_emoji: m.avatar_emoji ?? "🧑‍💻",
    total_cost: Number(m.total_cost) || 0,
    total_tokens: Number(m.total_tokens) || 0,
    cost_per_turn: Number(m.cost_per_turn) || 0,
    avg_cache_hit_rate: Number(m.avg_cache_hit_rate) || 0,
    total_agents: Number(m.total_agents) || 0,
    agent_ratio: Number(m.agent_ratio) || 0,
    total_turns: Number(m.total_turns) || 0,
  }));
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email[0]}***${email.slice(at)}`;
}

function displayLabel(m: Member): string {
  return m.display_name || maskEmail(m.email);
}

function fmtCost(n: number): string {
  if (n >= 10) return `$${n.toFixed(2)}`;
  if (n >= 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

function computeCompositeScores(
  members: Member[],
  weights: typeof DEFAULT_WEIGHTS
): Member[] {
  if (members.length === 0) return members;

  const vals = {
    cost_per_turn: members.map((m) => m.cost_per_turn),
    avg_cache_hit_rate: members.map((m) => m.avg_cache_hit_rate),
    agent_ratio: members.map((m) => m.agent_ratio),
    contribution: members.map((m) => m.total_cost + m.total_tokens / 1_000_000),
  };
  const mins = Object.fromEntries(
    Object.entries(vals).map(([k, vs]) => [k, Math.min(...vs)])
  ) as Record<keyof typeof vals, number>;
  const maxs = Object.fromEntries(
    Object.entries(vals).map(([k, vs]) => [k, Math.max(...vs)])
  ) as Record<keyof typeof vals, number>;

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;

  return members.map((m) => {
    const eff = 100 - normalize(m.cost_per_turn, mins.cost_per_turn, maxs.cost_per_turn);
    const cache = normalize(m.avg_cache_hit_rate, mins.avg_cache_hit_rate, maxs.avg_cache_hit_rate);
    const agent = normalize(m.agent_ratio, mins.agent_ratio, maxs.agent_ratio);
    const contrib = normalize(
      m.total_cost + m.total_tokens / 1_000_000,
      mins.contribution,
      maxs.contribution
    );
    const composite =
      (eff * weights.cost_per_turn +
        cache * weights.avg_cache_hit_rate +
        agent * weights.agent_ratio +
        contrib * weights.contribution) /
      totalWeight;
    return { ...m, composite_score: Math.round(composite * 10) / 10 };
  });
}

function getWinner(members: Member[], key: (typeof AWARDS)[number]["key"], higher: boolean): Member | undefined {
  if (members.length === 0) return undefined;
  return members.reduce((best, m) =>
    higher ? (m[key] > best[key] ? m : best) : (m[key] < best[key] ? m : best)
  );
}

export default function LeaderboardClient({
  teamId,
  currentUserId,
}: {
  teamId: string;
  currentUserId: string;
}) {
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [period, setPeriod] = useState("30");
  const [view, setView] = useState<"awards" | "composite">("awards");
  const [sortKey, setSortKey] = useState<MetricKey>("total_cost");
  const [sortAsc, setSortAsc] = useState(false);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}/leaderboard?period=${period}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "오류 발생"); return; }
      setTeam(data.team as Team);
      setMembers(parseMembers(data.members as MemberRaw[]));
    } catch (e) {
      setError(`네트워크 오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [teamId, period]);

  useEffect(() => { loadData(); }, [loadData]);

  const withScores = computeCompositeScores(members, weights);
  const sorted = [...withScores].sort((a, b) => {
    const av = (a[sortKey] as number) ?? 0;
    const bv = (b[sortKey] as number) ?? 0;
    return sortAsc ? av - bv : bv - av;
  });

  // Award winners (computed once, not inside map)
  const winners = Object.fromEntries(
    AWARDS.map((aw) => [aw.key, getWinner(members, aw.key, aw.higher)])
  ) as Record<(typeof AWARDS)[number]["key"], Member | undefined>;

  function handleSort(key: MetricKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(false); }
  }

  const th: React.CSSProperties = {
    padding: "8px 10px",
    textAlign: "right",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--ink-3)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "var(--font-mono)",
    borderBottom: "1px solid var(--line-hair)",
  };
  const td: React.CSSProperties = {
    padding: "9px 10px",
    textAlign: "right",
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    borderBottom: "1px solid var(--line-hair)",
  };

  if (loading) {
    return <div style={{ color: "var(--ink-3)", padding: 48, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 13 }}>로딩 중…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "var(--bad)", marginBottom: 12, fontSize: 13 }}>{error}</div>
        <button onClick={loadData} style={{ padding: "6px 14px", borderRadius: 3, border: "1px solid var(--line-hair)", background: "transparent", cursor: "pointer", fontSize: 12 }}>다시 시도</button>
      </div>
    );
  }
  if (!team) return null;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <a href="/teams" style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>← 팀 목록</a>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "4px 0 0", color: "var(--ink)" }}>{team.name}</h1>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <code style={{ fontSize: 12, background: "var(--bg-2)", padding: "3px 10px", borderRadius: 3, letterSpacing: "0.1em", fontFamily: "var(--font-mono)", color: "var(--ink-2)" }}>
            {team.invite_code}
          </code>
          <button
            onClick={() => { navigator.clipboard.writeText(team.invite_code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            style={{ fontSize: 11, padding: "4px 10px", borderRadius: 3, border: "1px solid var(--line-hair)", background: "transparent", cursor: "pointer", color: "var(--ink-3)" }}
          >
            {copied ? "복사됨" : "초대 코드 복사"}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 3 }}>
          {PERIODS.map((p) => (
            <button key={p.value} onClick={() => setPeriod(p.value)} style={{ padding: "5px 12px", borderRadius: 4, border: "1px solid var(--line-hair)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)", background: period === p.value ? "var(--ink)" : "transparent", color: period === p.value ? "var(--bg)" : "var(--ink-3)", fontWeight: period === p.value ? 600 : 400 }}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 3, marginLeft: "auto" }}>
          {(["awards", "composite"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "5px 12px", borderRadius: 4, border: "1px solid var(--line-hair)", fontSize: 12, cursor: "pointer", background: view === v ? "var(--ink)" : "transparent", color: view === v ? "var(--bg)" : "var(--ink-3)", fontWeight: view === v ? 600 : 400 }}>
              {v === "awards" ? "부문별 시상" : "종합 점수"}
            </button>
          ))}
        </div>
      </div>

      {/* Award cards */}
      {view === "awards" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 24 }}>
          {AWARDS.map((award) => {
            const winner = winners[award.key];
            const isMe = winner?.id === currentUserId;
            return (
              <div key={award.key} style={{ border: `1px solid ${isMe ? "var(--acc)" : "var(--line-hair)"}`, borderRadius: 4, padding: "14px 16px", background: isMe ? "var(--acc-bg)" : "var(--surface)" }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{award.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{award.label}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 8, fontFamily: "var(--font-mono)" }}>{award.desc}</div>
                {winner ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 16 }}>{winner.avatar_emoji}</span>
                      <span style={{ fontWeight: 600, fontSize: 13, color: isMe ? "var(--acc-ink)" : "var(--ink)" }}>
                        {displayLabel(winner)}{isMe ? " 👑" : ""}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                      {award.key === "total_cost" && fmtCost(winner.total_cost)}
                      {award.key === "cost_per_turn" && `${fmtCost(winner.cost_per_turn)}/turn`}
                      {award.key === "avg_cache_hit_rate" && `${(winner.avg_cache_hit_rate * 100).toFixed(1)}%`}
                      {award.key === "total_agents" && `${winner.total_agents}개`}
                      {award.key === "total_tokens" && fmtTokens(winner.total_tokens)}
                      {award.key === "agent_ratio" && `${(winner.agent_ratio * 100).toFixed(1)}%`}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--ink-4)" }}>데이터 없음</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Weight sliders */}
      {view === "composite" && (
        <div style={{ border: "1px solid var(--line-hair)", borderRadius: 4, padding: "16px 20px", marginBottom: 20, background: "var(--surface)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 14, color: "var(--ink)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>가중치 조정</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
            {(
              [
                { key: "cost_per_turn" as const, label: "효율성 (낮을수록 高점수)" },
                { key: "avg_cache_hit_rate" as const, label: "캐시 히트율 (높을수록 高점수)" },
                { key: "agent_ratio" as const, label: "에이전트 비율 (높을수록 高점수)" },
                { key: "contribution" as const, label: "총 기여 토큰+비용 (높을수록 高점수)" },
              ]
            ).map(({ key, label }) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-2)" }}>
                <span style={{ width: 200, flexShrink: 0 }}>{label}</span>
                <input type="range" min={0} max={100} value={weights[key]} onChange={(e) => setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))} style={{ flex: 1 }} />
                <span style={{ width: 28, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11 }}>{weights[key]}%</span>
              </label>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 10, fontFamily: "var(--font-mono)" }}>
            합계 {Object.values(weights).reduce((a, b) => a + b, 0)}% · score = Σ(정규화값 × 가중치), 효율성은 반전
          </div>
        </div>
      )}

      {/* Ranking table */}
      <div style={{ border: "1px solid var(--line-hair)", borderRadius: 4, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg-2)" }}>
              <th style={{ ...th, textAlign: "left", width: 36 }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>멤버</th>
              {view === "composite" && (
                <th style={th} onClick={() => handleSort("composite_score")}>
                  종합점수{sortKey === "composite_score" ? (sortAsc ? " ↑" : " ↓") : ""}
                </th>
              )}
              <th style={th} onClick={() => handleSort("total_cost")}>비용{sortKey === "total_cost" ? (sortAsc ? " ↑" : " ↓") : ""}</th>
              <th style={th} onClick={() => handleSort("total_tokens")}>토큰{sortKey === "total_tokens" ? (sortAsc ? " ↑" : " ↓") : ""}</th>
              <th style={th} onClick={() => handleSort("cost_per_turn")}>cost/turn{sortKey === "cost_per_turn" ? (sortAsc ? " ↑" : " ↓") : ""}</th>
              <th style={th} onClick={() => handleSort("avg_cache_hit_rate")}>캐시%{sortKey === "avg_cache_hit_rate" ? (sortAsc ? " ↑" : " ↓") : ""}</th>
              <th style={th} onClick={() => handleSort("total_agents")}>에이전트{sortKey === "total_agents" ? (sortAsc ? " ↑" : " ↓") : ""}</th>
              <th style={th} onClick={() => handleSort("agent_ratio")}>자동화%{sortKey === "agent_ratio" ? (sortAsc ? " ↑" : " ↓") : ""}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => {
              const isMe = m.id === currentUserId;
              const rowBg = isMe ? "var(--acc-bg)" : i % 2 === 0 ? "var(--surface)" : "var(--bg)";
              return (
                <tr key={m.id} style={{ background: rowBg }}>
                  <td style={{ ...td, textAlign: "left", fontSize: i < 3 ? 16 : 13, color: "var(--ink-3)" }}>
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </td>
                  <td style={{ ...td, textAlign: "left" }}>
                    <span style={{ marginRight: 6, fontSize: 16 }}>{m.avatar_emoji}</span>
                    <span style={{ fontWeight: isMe ? 700 : 400, color: isMe ? "var(--acc-ink)" : "var(--ink)" }}>
                      {displayLabel(m)}{isMe ? " (나)" : ""}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 8, fontFamily: "var(--font-mono)" }}>
                      {m.total_turns.toLocaleString("en-US")} turns
                    </span>
                  </td>
                  {view === "composite" && (
                    <td style={{ ...td, fontWeight: 600, color: isMe ? "var(--acc-ink)" : "var(--ink)" }}>
                      {m.composite_score != null ? m.composite_score.toFixed(1) : "—"}
                    </td>
                  )}
                  <td style={td}>
                    {fmtCost(m.total_cost)}
                    {winners.total_cost?.id === m.id && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--acc-ink)", fontFamily: "var(--font-mono)" }}>1위</span>}
                  </td>
                  <td style={td}>
                    {fmtTokens(m.total_tokens)}
                    {winners.total_tokens?.id === m.id && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--acc-ink)", fontFamily: "var(--font-mono)" }}>1위</span>}
                  </td>
                  <td style={td}>
                    {fmtCost(m.cost_per_turn)}
                    {winners.cost_per_turn?.id === m.id && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--acc-ink)", fontFamily: "var(--font-mono)" }}>1위</span>}
                  </td>
                  <td style={td}>
                    {(m.avg_cache_hit_rate * 100).toFixed(1)}%
                    {winners.avg_cache_hit_rate?.id === m.id && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--acc-ink)", fontFamily: "var(--font-mono)" }}>1위</span>}
                  </td>
                  <td style={td}>
                    {m.total_agents.toLocaleString("en-US")}
                    {winners.total_agents?.id === m.id && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--acc-ink)", fontFamily: "var(--font-mono)" }}>1위</span>}
                  </td>
                  <td style={td}>
                    {(m.agent_ratio * 100).toFixed(1)}%
                    {winners.agent_ratio?.id === m.id && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--acc-ink)", fontFamily: "var(--font-mono)" }}>1위</span>}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={view === "composite" ? 9 : 8} style={{ ...td, textAlign: "center", padding: 32, color: "var(--ink-3)" }}>
                  이 기간에 데이터가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
