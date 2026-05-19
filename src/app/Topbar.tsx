"use client";

import { usePathname } from "next/navigation";

export default function Topbar({ fetchedAt }: { fetchedAt?: string }) {
  const pathname = usePathname();

  const navItems = [
    { href: "/", label: "대시보드" },
    { href: "/stats", label: "통계" },
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
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="topbar-spacer" />

      {timeStr && (
        <div className="topbar-meta">
          <span className="mono" style={{ fontSize: 11 }}>
            {timeStr} 기준
          </span>
        </div>
      )}
    </header>
  );
}
