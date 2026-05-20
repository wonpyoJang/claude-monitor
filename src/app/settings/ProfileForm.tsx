"use client";

import { useState } from "react";

const EMOJIS = [
  "🧑‍💻","👨‍💻","👩‍💻","🤖","👾","🦊","🐼","🦁","🐯","🦄",
  "🐙","🦋","🚀","⭐","🌊","🔥","⚡","🎯","💎","🎩",
  "🐸","🦖","🐬","🦅","🌵","🍀","🎮","🔮","🧩","🪄",
];

export default function ProfileForm({
  initialName,
  initialEmoji,
  initialLeaderboard,
}: {
  initialName: string;
  initialEmoji: string;
  initialLeaderboard: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji || "🧑‍💻");
  const [inLeaderboard, setInLeaderboard] = useState(initialLeaderboard);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name, avatar_emoji: emoji, show_in_leaderboard: inLeaderboard }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "저장 실패"); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-6 border border-zinc-800 rounded p-4 bg-zinc-900">
      <h2 className="font-semibold mb-4 text-zinc-300">프로필</h2>

      {/* Avatar preview + picker */}
      <div className="mb-4">
        <div className="text-zinc-500 text-xs mb-2 uppercase tracking-widest">아바타</div>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-2xl border border-zinc-700">
            {emoji}
          </div>
          <span className="text-zinc-400 text-xs">아래에서 선택</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              className={`w-9 h-9 rounded text-xl flex items-center justify-center transition-colors ${
                emoji === e
                  ? "bg-zinc-600 ring-2 ring-zinc-400"
                  : "bg-zinc-800 hover:bg-zinc-700"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Nickname */}
      <div className="mb-4">
        <div className="text-zinc-500 text-xs mb-2 uppercase tracking-widest">닉네임</div>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            maxLength={20}
            placeholder="팀에서 표시될 이름 (최대 20자)"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500 placeholder-zinc-600"
          />
          <span className="text-zinc-600 text-xs w-10 text-right">{name.length}/20</span>
        </div>
        <p className="text-zinc-600 text-xs mt-1">비워두면 랭킹보드에 이메일 앞자리가 표시됩니다.</p>
      </div>

      {/* Leaderboard toggle */}
      <div className="mb-4">
        <div className="text-zinc-500 text-xs mb-2 uppercase tracking-widest">효율 랭킹 참여</div>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div
            onClick={() => setInLeaderboard((v) => !v)}
            className={`relative w-10 h-6 rounded-full transition-colors ${inLeaderboard ? "bg-emerald-600" : "bg-zinc-700"}`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${inLeaderboard ? "translate-x-5" : "translate-x-1"}`} />
          </div>
          <span className="text-zinc-400 text-sm">{inLeaderboard ? "참여 중" : "참여 안 함"}</span>
        </label>
        <p className="text-zinc-600 text-xs mt-1">켜면 동일 서비스를 쓰는 사람들과 효율 지표가 비교됩니다.</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm px-4 py-2 rounded transition-colors disabled:opacity-50"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        {saved && <span className="text-xs text-emerald-400">저장됨 ✓</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </section>
  );
}
