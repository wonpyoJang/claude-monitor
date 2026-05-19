"use client";
import { useState, useEffect } from "react";

export default function LastUpdated({ fetchedAt }: { fetchedAt: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    function update() {
      const diff = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 1000);
      if (diff < 60) setLabel(`${diff}초 전`);
      else if (diff < 3600) setLabel(`${Math.floor(diff / 60)}분 전`);
      else setLabel(`${Math.floor(diff / 3600)}시간 전`);
    }
    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, [fetchedAt]);

  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <span>업데이트 {label}</span>
      <button
        onClick={() => window.location.reload()}
        className="border border-zinc-800 rounded px-2 py-0.5 hover:text-zinc-200 hover:border-zinc-600"
      >
        새로고침
      </button>
    </div>
  );
}
