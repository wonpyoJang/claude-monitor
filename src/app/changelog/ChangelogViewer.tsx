"use client";

import { useEffect } from "react";

const APP_VERSION = "0.9.0";
const SEEN_KEY = "cm_last_seen_version";

type Release = {
  version: string;
  date: string;
  sections: { title: string; items: string[] }[];
};

const SECTION_COLORS: Record<string, string> = {
  Added: "var(--good)",
  Fixed: "var(--bad)",
  Changed: "var(--warn)",
  Removed: "var(--bad)",
  Security: "var(--warn)",
  Deprecated: "var(--ink-3)",
};

function parseBold(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} style={{ color: "var(--ink)", fontWeight: 600 }}>{p.slice(2, -2)}</strong>
      : p
  );
}

export default function ChangelogViewer({ releases }: { releases: Release[] }) {
  // Mark current version as seen
  useEffect(() => {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
  }, []);

  if (releases.length === 0) {
    return <p style={{ color: "var(--ink-3)", fontSize: 13 }}>출시노트가 없습니다.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      {releases.map((release, ri) => (
        <div key={release.version} style={{ display: "flex", gap: 32 }}>
          {/* Version label */}
          <div style={{ width: 110, flexShrink: 0, paddingTop: 3 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14, color: ri === 0 ? "var(--acc-ink)" : "var(--ink-2)" }}>
              v{release.version}
              {ri === 0 && (
                <span style={{ marginLeft: 6, fontSize: 9, background: "var(--acc)", color: "#fff", borderRadius: 3, padding: "1px 5px", verticalAlign: "middle", fontWeight: 600 }}>
                  LATEST
                </span>
              )}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-4)", marginTop: 3 }}>
              {release.date}
            </div>
          </div>

          {/* Content */}
          <div style={{ flex: 1, borderLeft: `2px solid ${ri === 0 ? "var(--acc)" : "var(--line-hair)"}`, paddingLeft: 24 }}>
            {release.sections.map((sec) => (
              <div key={sec.title} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: SECTION_COLORS[sec.title] ?? "var(--ink-3)", marginBottom: 8 }}>
                  {sec.title}
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {sec.items.map((item, i) => (
                    <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
                      <span style={{ color: "var(--ink-4)", flexShrink: 0, marginTop: 1 }}>·</span>
                      <span>{parseBold(item)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
