"use client";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <button
      onClick={handleLogout}
      className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded px-2 py-1"
    >
      로그아웃
    </button>
  );
}
