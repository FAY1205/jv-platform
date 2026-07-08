import Link from "next/link";
import { APP_NAME } from "@/lib/app";

// Route-private app chrome for the admin views (underscore keeps it out of routing).
const NAV = [
  { href: "/runs", label: "Runs" },
  { href: "/partners", label: "Partners" },
];

export function TopBar({ active }: { active?: "runs" | "partners" }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1160px] items-center justify-between px-6 py-3.5">
        <div className="flex items-center gap-6">
          <Link href="/runs" className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-brand text-[.7rem] font-bold text-white">JV</span>
            <span className="font-display text-[.95rem] font-semibold tracking-tight">{APP_NAME}</span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const isActive = active === item.label.toLowerCase();
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors " +
                    (isActive ? "bg-surface-3 text-text" : "text-text-3 hover:text-text-2")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <span className="num text-xs text-text-3">admin</span>
      </div>
    </header>
  );
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
