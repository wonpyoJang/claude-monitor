"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json();
      setError(data.error ?? "로그인 실패");
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--acc)", display: "inline-block" }} />
          Claude Monitor
        </div>
        <h1 className="auth-title">로그인</h1>
        <p className="auth-sub">계속하려면 이메일과 비밀번호를 입력하세요.</p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label className="input-label">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input-field"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="input-label">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input-field"
            />
          </div>
          {error && (
            <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--bad)" }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 4, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <p style={{ marginTop: 24, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>
          계정 없음?{" "}
          <Link href="/register" style={{ color: "var(--ink)", borderBottom: "1px solid var(--line-hair)", paddingBottom: 1 }}>
            회원가입
          </Link>
        </p>
      </div>
    </div>
  );
}
