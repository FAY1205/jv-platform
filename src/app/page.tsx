import { APP_NAME } from "@/lib/app";

// Placeholder landing page for WP-001. The real admin dashboard and partner portal
// shells arrive with the component library (WP-004) and the pipeline spine (Phase 1).
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          JV Lead Matching Platform — foundations in progress. The spec is the contract; see{" "}
          <code>docs/SPEC.md</code>.
        </p>
      </div>
    </main>
  );
}
