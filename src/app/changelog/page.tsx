import { readFile } from "fs/promises";
import path from "path";
import Topbar from "@/app/Topbar";
import ChangelogViewer from "./ChangelogViewer";

export const dynamic = "force-dynamic";

type Release = {
  version: string;
  date: string;
  sections: { title: string; items: string[] }[];
};

function parseChangelog(text: string): Release[] {
  const releases: Release[] = [];
  const lines = text.split("\n");
  let current: Release | null = null;
  let currentSection: { title: string; items: string[] } | null = null;

  for (const line of lines) {
    // ## [0.2.0] — 2026-05-19
    const releaseMatch = line.match(/^##\s+\[(.+?)\]\s*[—–-]\s*(.+)/);
    if (releaseMatch) {
      if (currentSection && current) current.sections.push(currentSection);
      if (current) releases.push(current);
      currentSection = null;
      current = { version: releaseMatch[1], date: releaseMatch[2].trim(), sections: [] };
      continue;
    }
    // ### Added / Fixed / ...
    const sectionMatch = line.match(/^###\s+(.+)/);
    if (sectionMatch && current) {
      if (currentSection) current.sections.push(currentSection);
      currentSection = { title: sectionMatch[1], items: [] };
      continue;
    }
    // - bullet item
    const itemMatch = line.match(/^-\s+(.+)/);
    if (itemMatch && currentSection) {
      currentSection.items.push(itemMatch[1]);
    }
  }
  if (currentSection && current) current.sections.push(currentSection);
  if (current) releases.push(current);
  return releases;
}

export default async function ChangelogPage() {
  let releases: Release[] = [];
  try {
    const filePath = path.join(process.cwd(), "CHANGELOG.md");
    const text = await readFile(filePath, "utf-8");
    releases = parseChangelog(text);
  } catch {
    // fallback if file missing
  }

  const latestVersion = releases[0]?.version ?? "0.1.0";

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px 80px" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Claude Monitor
          </div>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 36, fontWeight: 400, margin: 0, letterSpacing: "-0.02em", color: "var(--ink)" }}>
            출시노트
          </h1>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
            현재 버전 <strong style={{ color: "var(--acc-ink)" }}>v{latestVersion}</strong>
          </p>
        </div>
        <ChangelogViewer releases={releases} />
      </main>
    </>
  );
}
