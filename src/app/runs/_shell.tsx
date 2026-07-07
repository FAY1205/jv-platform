import Link from "next/link";
import { APP_NAME } from "@/lib/app";

// Route-private app chrome for the run views (underscore keeps it out of routing).
export function TopBar() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1160px] items-center justify-between px-6 py-3.5">
        <Link href="/runs" className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-brand text-[.7rem] font-bold text-white">JV</span>
          <span className="font-display text-[.95rem] font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <span className="num text-xs text-text-3">admin</span>
      </div>
    </header>
  );
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
