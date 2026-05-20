import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Topbar from "@/app/Topbar";
import LeaderboardClient from "./LeaderboardClient";

export const dynamic = "force-dynamic";

export default async function TeamLeaderboardPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 980, margin: "0 auto", padding: "32px 20px" }}>
        <LeaderboardClient teamId={id} currentUserId={session.sub} />
      </main>
    </>
  );
}
