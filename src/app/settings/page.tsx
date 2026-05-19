import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import LogoutButton from "./LogoutButton";
import CopyButton from "./CopyButton";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let ingestToken = "";
  try {
    const result = await pool.query(
      "SELECT ingest_token FROM users WHERE id = $1",
      [session.sub]
    );
    ingestToken = (result.rows[0] as { ingest_token: string })?.ingest_token ?? "";
  } finally {
    await pool.end();
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://claude-monitor-nine.vercel.app";

  const monitorJson = JSON.stringify(
    {
      url: appUrl,
      token: ingestToken,
      device: { id: null, alias: "my-mac", hostname: null, os: null },
    },
    null,
    2
  );

  const installCmd = `curl -fsSL ${appUrl}/install.sh | bash`;
  const oneLineCmd = `INGEST_TOKEN=${ingestToken} bash <(curl -fsSL ${appUrl}/install.sh)`;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-mono text-sm">
      <div className="max-w-2xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-xl font-bold">Settings</h1>
          <div className="flex gap-3 items-center">
            <a href="/" className="text-zinc-400 hover:text-zinc-100 text-xs">← 대시보드</a>
            <LogoutButton />
          </div>
        </div>

        <section className="mb-6 border border-zinc-800 rounded p-4 bg-zinc-900">
          <h2 className="font-semibold mb-3 text-zinc-300">계정</h2>
          <p className="text-zinc-400 text-xs">{session.email}</p>
        </section>

        {/* INGEST TOKEN */}
        <section className="mb-6 border border-zinc-800 rounded p-4 bg-zinc-900">
          <div className="flex justify-between items-center mb-1">
            <h2 className="font-semibold text-zinc-300">INGEST_TOKEN</h2>
            <CopyButton text={ingestToken} />
          </div>
          <p className="text-zinc-500 text-xs mb-3">설치 스크립트 실행 시 이 토큰을 붙여넣으세요. 외부 노출 금지.</p>
          <code className="block bg-zinc-800 p-3 rounded text-xs break-all text-zinc-200 select-all">
            {ingestToken}
          </code>
        </section>

        {/* INSTALL */}
        <section className="mb-6 border border-zinc-800 rounded p-4 bg-zinc-900">
          <h2 className="font-semibold mb-3 text-zinc-300">클라이언트 설치 (다른 Mac)</h2>

          <div className="space-y-4 text-xs">
            {/* 원라이너 */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <p className="text-zinc-300 font-medium">원라이너 (토큰 포함 — 추천)</p>
                <CopyButton text={oneLineCmd} />
              </div>
              <p className="text-zinc-500 mb-2">Mac 이름만 추가로 입력하면 됩니다.</p>
              <code className="block bg-zinc-800 p-2 rounded text-zinc-200 break-all select-all">
                {oneLineCmd}
              </code>
            </div>

            <div className="border-t border-zinc-800 pt-4">
              <div className="flex justify-between items-center mb-1">
                <p className="text-zinc-400">일반 설치 (토큰 직접 입력)</p>
                <CopyButton text={installCmd} />
              </div>
              <code className="block bg-zinc-800 p-2 rounded text-zinc-200 select-all">{installCmd}</code>
            </div>

            <div className="bg-zinc-800/60 rounded p-3 space-y-1 text-zinc-400">
              <p className="text-zinc-300 font-medium mb-1">설치 중 프롬프트</p>
              <div><span className="text-zinc-500">INGEST_TOKEN:</span> 위 토큰 붙여넣기 (원라이너는 자동 입력)</div>
              <div><span className="text-zinc-500">Mac 이름:</span> 예) work-mac, home-mac (엔터 시 hostname 사용)</div>
            </div>

            <p className="text-zinc-500">설치 완료 후 Claude Code 세션이 끝날 때마다 자동으로 대시보드에 기록됩니다.</p>
          </div>
        </section>

        {/* MANUAL CONFIG */}
        <section className="border border-zinc-800 rounded p-4 bg-zinc-900">
          <div className="flex justify-between items-center mb-1">
            <h2 className="font-semibold text-zinc-300">수동 설정 (~/.claude/monitor.json)</h2>
            <CopyButton text={monitorJson} />
          </div>
          <p className="text-zinc-500 text-xs mb-3">
            스크립트 없이 직접 설정할 경우.{" "}
            <span className="text-zinc-600">alias는 Mac마다 다르게. id/hostname/os는 null로 두면 첫 실행 시 자동 입력됩니다.</span>
          </p>
          <pre className="bg-zinc-800 p-3 rounded text-xs text-zinc-200 overflow-x-auto select-all">
            {monitorJson}
          </pre>
        </section>
      </div>
    </main>
  );
}
