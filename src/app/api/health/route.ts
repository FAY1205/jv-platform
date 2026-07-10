import { jsonOk } from "@/lib/http";

// F-07: lightweight liveness/heartbeat endpoint for uptime monitors + the cron
// heartbeat. No auth, no DB — it answers "is the app serving?" and nothing more, so
// it can't leak anything or fail on a DB hiccup.
export async function GET() {
  return jsonOk({ status: "ok" });
}
