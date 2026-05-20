"use client";

export default function TeamError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ padding: "60px 32px", textAlign: "center" }}>
      <div style={{ fontSize: 13, color: "var(--bad)", marginBottom: 12, fontFamily: "var(--font-mono)" }}>
        오류 발생
      </div>
      <div style={{ fontSize: 14, color: "var(--ink-2)", marginBottom: 8 }}>
        {error.message || "알 수 없는 오류"}
      </div>
      <pre style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-mono)", marginBottom: 20, textAlign: "left", display: "inline-block" }}>
        {error.stack?.slice(0, 400)}
      </pre>
      <br />
      <button
        onClick={reset}
        style={{ padding: "8px 20px", borderRadius: 4, background: "var(--ink)", color: "var(--bg)", border: "none", cursor: "pointer", fontSize: 13 }}
      >
        다시 시도
      </button>
    </div>
  );
}
