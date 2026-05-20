"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const APP_VERSION = "0.4.0";
const SEEN_KEY = "cm_last_seen_version";

export default function Topbar({ fetchedAt }: { fetchedAt?: string }) {
  const pathname = usePathname();
  const [hasNew, setHasNew] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      setHasNew(seen !== APP_VERSION);
    } catch { /* ignore */ }
  }, []);

  const navItems = [
    { href: "/", label: "대시보드" },
    { href: "/stats", label: "통계" },
    { href: "/mirror", label: "거울" },
    { href: "/teams", label: "팀 랭킹" },
    { href: "/changelog", label: "출시노트", badge: hasNew },
    { href: "/settings", label: "설정" },
  ];

  const timeStr = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <header className="topbar">
      <a href="/" className="topbar-brand">
        <span className="topbar-brand-dot" />
        Claude Monitor
      </a>

      <nav className="topbar-nav">
        {navItems.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <a
              key={item.href}
              href={item.href}
              className={`topbar-nav-btn${active ? " active" : ""}`}
              style={{ position: "relative" }}
            >
              {item.label}
              {item.badge && (
                <span style={{
                  position: "absolute",
                  top: 4,
                  right: 2,
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--acc)",
                  display: "block",
                }} />
              )}
            </a>
          );
        })}
      </nav>

      <div className="topbar-spacer" />

      <div className="topbar-meta" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {timeStr && (
          <span className="mono" style={{ fontSize: 11 }}>
            {timeStr} 기준
          </span>
        )}
        <button
          onClick={() => window.location.reload()}
          title="데이터 새로고침"
          style={{
            background: "none",
            border: "1px solid var(--line-hair)",
            borderRadius: 4,
            color: "var(--ink-3)",
            cursor: "pointer",
            fontSize: 11,
            lineHeight: 1,
            padding: "2px 6px",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--ink-1)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--ink-3)")}
        >
          ↻
        </button>
      </div>
    </header>
  );
}
