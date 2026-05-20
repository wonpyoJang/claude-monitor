"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TeamRow = {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  member_count: number;
  is_owner: boolean;
};

export default function TeamsClient({
  initialTeams,
  currentUserId: _currentUserId,
}: {
  initialTeams: TeamRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [teams, setTeams] = useState<TeamRow[]>(initialTeams);
  const [newName, setNewName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showJoinConsent, setShowJoinConsent] = useState(false);
  const [joinConsentChecked, setJoinConsentChecked] = useState(false);

  async function createTeam() {
    if (!newName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "오류 발생"); return; }
      setTeams((prev) => [
        { ...data.team, member_count: 1, is_owner: true, created_at: new Date().toISOString() },
        ...prev,
      ]);
      setNewName("");
    } finally {
      setLoading(false);
    }
  }

  function openJoinConsent() {
    if (!inviteCode.trim()) return;
    setJoinConsentChecked(false);
    setShowJoinConsent(true);
  }

  async function joinTeam() {
    setShowJoinConsent(false);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/teams/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_code: inviteCode.trim() }),
      });
      const data = await res.json();
      if (res.status === 409) {
        router.push(`/teams/${data.team_id}`);
        return;
      }
      if (!res.ok) { setError(data.error ?? "오류 발생"); return; }
      setInviteCode("");
      router.push(`/teams/${data.team.id}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteTeam(teamId: string) {
    if (!confirm("팀을 삭제하면 복구할 수 없습니다. 계속할까요?")) return;
    setDeleting(teamId);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "삭제 오류"); return; }
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
    } finally {
      setDeleting(null);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 4,
    border: "1px solid var(--line-hair)",
    fontSize: 13,
    background: "var(--bg-2)",
    color: "var(--ink)",
    boxSizing: "border-box",
    marginBottom: 10,
    outline: "none",
  };
  const btnPrimary: React.CSSProperties = {
    width: "100%",
    padding: "8px 0",
    borderRadius: 4,
    border: "none",
    background: "var(--ink)",
    color: "var(--bg)",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  };

  return (
    <div>
      {teams.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, fontFamily: "var(--font-mono)" }}>
            내 팀
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {teams.map((team) => (
              <div key={team.id} style={{ border: "1px solid var(--line-hair)", borderRadius: 4, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14, background: "var(--surface)" }}>
                <div style={{ flex: 1 }}>
                  <a href={`/teams/${team.id}`} style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>
                    {team.name}
                  </a>
                  <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                    {team.member_count}명 {team.is_owner && "· 내가 만든 팀"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <code style={{ fontSize: 12, background: "var(--bg-2)", padding: "2px 8px", borderRadius: 3, letterSpacing: "0.1em", fontFamily: "var(--font-mono)", color: "var(--ink-2)" }}>
                    {team.invite_code}
                  </code>
                  <button onClick={() => copyCode(team.invite_code)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 3, border: "1px solid var(--line-hair)", background: "transparent", cursor: "pointer", color: "var(--ink-3)" }}>
                    {copied === team.invite_code ? "복사됨" : "복사"}
                  </button>
                  <a href={`/teams/${team.id}`} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 3, border: "1px solid var(--acc)", color: "var(--acc)", textDecoration: "none" }}>
                    랭킹 보기
                  </a>
                  {team.is_owner && (
                    <button
                      onClick={() => deleteTeam(team.id)}
                      disabled={deleting === team.id}
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 3, border: "1px solid var(--bad)", background: "transparent", cursor: "pointer", color: "var(--bad)", opacity: deleting === team.id ? 0.5 : 1 }}
                    >
                      {deleting === team.id ? "삭제 중…" : "삭제"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid var(--line-hair)", borderRadius: 4, padding: 20, background: "var(--surface)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "var(--ink)" }}>팀 만들기</div>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createTeam()} placeholder="팀 이름" style={inputStyle} />
          <button onClick={createTeam} disabled={loading || !newName.trim()} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
            만들기
          </button>
        </div>
        <div style={{ border: "1px solid var(--line-hair)", borderRadius: 4, padding: 20, background: "var(--surface)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "var(--ink)" }}>팀 가입</div>
          <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && openJoinConsent()} placeholder="초대 코드 입력" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          <button onClick={openJoinConsent} disabled={loading || !inviteCode.trim()} style={{ ...btnPrimary, opacity: loading || !inviteCode.trim() ? 0.4 : 1 }}>
            가입하기
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 4, background: "var(--bad-bg)", border: "1px solid var(--bad)", color: "var(--bad)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {teams.length === 0 && (
        <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 24, textAlign: "center" }}>
          아직 속한 팀이 없어요. 팀을 만들거나 초대 코드로 가입하세요.
        </p>
      )}

      {/* 팀 가입 동의 모달 */}
      {showJoinConsent && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowJoinConsent(false); }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line-hair)",
              borderRadius: 6,
              padding: 24,
              width: "100%",
              maxWidth: 400,
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)", marginTop: 0, marginBottom: 16 }}>
              팀 가입 전 동의
            </h2>

            <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.7, marginBottom: 20 }}>
              <p style={{ margin: "0 0 10px" }}>
                팀 가입 시 내 Claude Code 사용 통계(모델, 토큰, 비용 추정치)가 팀원들에게 공개됩니다.
              </p>
              <p style={{ margin: 0 }}>
                팀 관리자는 팀 통계 페이지에서 내 랭킹을 확인할 수 있습니다.
              </p>
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                cursor: "pointer",
                padding: "12px 14px",
                border: "1px solid var(--line-hair)",
                borderRadius: 4,
                background: joinConsentChecked ? "var(--acc-bg)" : "var(--bg-2)",
                marginBottom: 20,
                transition: "background 0.15s",
              }}
            >
              <input
                type="checkbox"
                checked={joinConsentChecked}
                onChange={(e) => setJoinConsentChecked(e.target.checked)}
                style={{
                  marginTop: 2,
                  accentColor: "var(--acc)",
                  flexShrink: 0,
                  width: 15,
                  height: 15,
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>
                위 내용을 이해하고 팀에 가입하겠습니다.
              </span>
            </label>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowJoinConsent(false)}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 4,
                  border: "1px solid var(--line-soft)",
                  background: "transparent",
                  color: "var(--ink-3)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                }}
              >
                취소
              </button>
              <button
                onClick={joinTeam}
                disabled={!joinConsentChecked}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 4,
                  border: "none",
                  background: "var(--ink)",
                  color: "var(--bg)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: joinConsentChecked ? "pointer" : "not-allowed",
                  opacity: joinConsentChecked ? 1 : 0.4,
                  fontFamily: "var(--font-sans)",
                }}
              >
                동의 후 가입
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
