"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const CONSENT_ITEMS = [
  {
    id: "terms",
    label: "서비스 이용약관 동의 [필수]",
    description:
      "본 서비스는 Claude Code 사용 현황을 수집·집계하여 개인 및 팀 통계를 제공합니다.",
  },
  {
    id: "privacy",
    label: "개인정보 수집·이용 동의 [필수]",
    description:
      "이메일 주소를 수집하며, 서비스 제공 목적 외 제3자에게 제공하지 않습니다.",
  },
  {
    id: "data",
    label: "데이터 처리 동의 [필수]",
    description:
      "Claude Code CLI가 전송하는 사용 로그(모델, 토큰 수, 비용 추정치)가 서버에 저장됩니다.",
  },
] as const;

type ConsentId = (typeof CONSENT_ITEMS)[number]["id"];

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [consents, setConsents] = useState<Record<ConsentId, boolean>>({
    terms: false,
    privacy: false,
    data: false,
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const allChecked = CONSENT_ITEMS.every((item) => consents[item.id]);

  function toggleConsent(id: ConsentId) {
    setConsents((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/register", {
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
      setError(data.error ?? "등록 실패");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          padding: 24,
          border: "1px solid var(--line-hair)",
          borderRadius: 6,
          background: "var(--surface)",
        }}
      >
        {/* 스텝 인디케이터 */}
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            marginBottom: 20,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
          }}
        >
          {step === 1 ? "1/2 동의" : "2/2 가입"}
        </div>

        <h1
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--ink)",
            marginBottom: 20,
            marginTop: 0,
          }}
        >
          Claude Code Monitor — 회원가입
        </h1>

        {step === 1 && (
          <div>
            <p
              style={{
                fontSize: 13,
                color: "var(--ink-3)",
                marginBottom: 20,
                lineHeight: 1.6,
              }}
            >
              서비스 이용을 위해 아래 항목에 모두 동의해 주세요.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {CONSENT_ITEMS.map((item) => (
                <label
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    cursor: "pointer",
                    padding: "12px 14px",
                    border: "1px solid var(--line-hair)",
                    borderRadius: 4,
                    background: consents[item.id] ? "var(--acc-bg)" : "var(--bg-2)",
                    transition: "background 0.15s",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={consents[item.id]}
                    onChange={() => toggleConsent(item.id)}
                    style={{
                      marginTop: 2,
                      accentColor: "var(--acc)",
                      flexShrink: 0,
                      width: 15,
                      height: 15,
                      cursor: "pointer",
                    }}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink)",
                        marginBottom: 4,
                      }}
                    >
                      {item.label}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-3)",
                        lineHeight: 1.6,
                      }}
                    >
                      {item.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!allChecked}
              style={{
                width: "100%",
                marginTop: 20,
                padding: "9px 0",
                borderRadius: 4,
                border: "none",
                background: "var(--ink)",
                color: "var(--bg)",
                fontWeight: 600,
                fontSize: 13,
                cursor: allChecked ? "pointer" : "not-allowed",
                opacity: allChecked ? 1 : 0.4,
                fontFamily: "var(--font-sans)",
              }}
            >
              다음
            </button>

            <p
              style={{
                marginTop: 16,
                fontSize: 12,
                color: "var(--ink-4)",
                textAlign: "center",
              }}
            >
              이미 계정 있음?{" "}
              <Link
                href="/login"
                style={{ color: "var(--ink-2)", textDecoration: "underline" }}
              >
                로그인
              </Link>
            </p>
          </div>
        )}

        {step === 2 && (
          <div>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "var(--ink-3)",
                    marginBottom: 6,
                  }}
                >
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 4,
                    border: "1px solid var(--line-hair)",
                    fontSize: 13,
                    background: "var(--bg-2)",
                    color: "var(--ink)",
                    boxSizing: "border-box",
                    outline: "none",
                    fontFamily: "var(--font-sans)",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "var(--ink-3)",
                    marginBottom: 6,
                  }}
                >
                  Password (8자 이상)
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 4,
                    border: "1px solid var(--line-hair)",
                    fontSize: 13,
                    background: "var(--bg-2)",
                    color: "var(--ink)",
                    boxSizing: "border-box",
                    outline: "none",
                    fontFamily: "var(--font-sans)",
                  }}
                />
              </div>

              {error && (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--bad)",
                    margin: 0,
                    padding: "8px 12px",
                    background: "var(--bad-bg)",
                    borderRadius: 4,
                    border: "1px solid var(--bad)",
                  }}
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "9px 0",
                  borderRadius: 4,
                  border: "none",
                  background: "var(--ink)",
                  color: "var(--bg)",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.4 : 1,
                  fontFamily: "var(--font-sans)",
                }}
              >
                {loading ? "..." : "가입하기"}
              </button>
            </form>

            <button
              onClick={() => setStep(1)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--ink-3)",
                padding: "10px 0 0",
                width: "100%",
                textAlign: "center",
                fontFamily: "var(--font-sans)",
              }}
            >
              ← 동의 화면으로 돌아가기
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
