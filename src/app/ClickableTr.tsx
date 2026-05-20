"use client";
import { useRouter } from "next/navigation";

export default function ClickableTr({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <tr
      className={className}
      onClick={() => router.push(href)}
      style={{ cursor: "pointer" }}
    >
      {children}
    </tr>
  );
}
