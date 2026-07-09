// Demo-only seeder (NOT part of the real seed): gives the demo tenant believable
// lead-lifecycle activity so the performance dashboard shows real-looking numbers.
// Adds status history to the current import's delivered leads and a backdated
// prior-week import with its own leads + statuses (so week-over-week deltas, the
// weekly trend, and time-to-contact all populate).
//
// Idempotent + easily wiped:  node scripts/seed-demo-activity.mjs --wipe
// Re-running without --wipe resets the demo activity to the same deterministic set.
// Every event timestamp is clamped to <= now (no future-dated history).

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const WIPE_ONLY = process.argv.includes("--wipe");
const BACKDATED_REF = "UP-2026-000";
const BACKDATED_LEAD_PREFIX = "LD-2025-9"; // sentinel for demo backdated leads

const [{ now }] = await sql`select now() as now`;
const NOW = now.getTime();
const DAY = 86_400_000;

const [tenant] = await sql`select id from tenants order by created_at limit 1`;
const partners = await sql`select id, ref_id from partners where tenant_id=${tenant.id} and deleted_at is null order by ref_id`;

async function wipe() {
  // Remove any prior demo activity: backdated import (+ its leads + history) and
  // the status history on the current import's leads.
  const back = await sql`select id from uploads where tenant_id=${tenant.id} and ref_id=${BACKDATED_REF}`;
  if (back.length) {
    const backLeads = await sql`select id from leads where upload_id=${back[0].id}`;
    const ids = backLeads.map((l) => l.id);
    if (ids.length) await sql`delete from lead_status_history where lead_id in ${sql(ids)}`;
    await sql`delete from leads where upload_id=${back[0].id}`;
    await sql`delete from uploads where id=${back[0].id}`;
  }
  const curLeads = await sql`
    select l.id from leads l join uploads u on u.id=l.upload_id
    where u.tenant_id=${tenant.id} and u.ref_id='UP-2026-001'`;
  const curIds = curLeads.map((l) => l.id);
  if (curIds.length) await sql`delete from lead_status_history where lead_id in ${sql(curIds)}`;
  console.log("wiped demo activity");
}

await wipe();
if (WIPE_ONLY) {
  await sql.end();
  console.log("done (wipe only)");
  process.exit(0);
}

// A history row, only if the event is not in the future.
async function event(leadId, status, atMs) {
  if (atMs > NOW) return false;
  await sql`insert into lead_status_history (tenant_id, lead_id, status, created_at)
            values (${tenant.id}, ${leadId}, ${status}, ${new Date(atMs).toISOString()})`;
  return true;
}

// Progressions keyed 0..4 — each a list of [status, dayOffsetFromReceived].
const PROGRESSIONS = [
  [], // New — untouched
  [["Contacted", 0.2]],
  [["Contacted", 0.3], ["Appointment", 2]],
  [["Contacted", 0.25], ["Under contract", 2], ["Closed", 5]],
  [["Contacted", 1], ["Dead", 3]],
];

async function applyProgression(leadId, receivedMs, p) {
  for (const [status, off] of p) await event(leadId, status, receivedMs + off * DAY);
}

// ── 1. Backdated prior-week import (received ~7 days ago) ────────────────────
const backReceived = NOW - 8 * DAY;
const [backUpload] = await sql`
  insert into uploads (tenant_id, ref_id, filename, status, row_count, created_at)
  values (${tenant.id}, ${BACKDATED_REF}, ${"week-of-jun29.xlsx"}, 'processed', 26, ${new Date(backReceived).toISOString()})
  returning id`;

const CAMPAIGNS = ["Lead Zolo 1.0", "Lead Zolo 2.0", "Real Estate Bees"];
const STATES = ["NJ", "VA", "SC", "CT"];
let made = 0;
let closes = 0;
for (let i = 0; i < 26; i++) {
  const partner = partners[i % partners.length];
  const received = backReceived + (i % 5) * 0.4 * DAY; // small jitter within the day-range
  const campaign = CAMPAIGNS[i % CAMPAIGNS.length];
  // ~15% removed (feeds source removal rate); those are not delivered/worked.
  const removed = i % 7 === 0;
  const ref = `${BACKDATED_LEAD_PREFIX}${String(1000 + i)}`;
  const [lead] = await sql`
    insert into leads (tenant_id, ref_id, upload_id, dedupe_key, raw_json, campaign, address, city, state, zip,
                       seller_first, seller_last, partner_id, match_method, mls_status, created_at)
    values (${tenant.id}, ${ref}, ${backUpload.id}, ${"demo|" + ref}, ${sql.json({ demo: true })}, ${campaign},
            ${100 + i + " Prior Ave"}, ${"Rivertown"}, ${STATES[i % STATES.length]}, ${"0" + (7000 + i)},
            ${"Sam"}, ${"Prior" + i}, ${removed ? null : partner.id}, ${removed ? "none" : "state_fallback"},
            ${removed ? "removed" : "kept"}, ${new Date(received).toISOString()})
    returning id`;
  made++;
  if (!removed) {
    const prog = PROGRESSIONS[i % PROGRESSIONS.length];
    await applyProgression(lead.id, received, prog);
    if (prog.some(([s]) => s === "Closed")) closes++;
  }
}

// ── 2. Current import: contact ~half of the delivered leads (leave rest New) ──
const current = await sql`
  select l.id, l.created_at from leads l join uploads u on u.id=l.upload_id
  where u.tenant_id=${tenant.id} and u.ref_id='UP-2026-001' and l.partner_id is not null and l.mls_status='kept'
  order by l.ref_id`;
let contacted = 0;
for (let i = 0; i < current.length; i++) {
  if (i % 2 === 0) continue; // leave half untouched (New)
  const received = current[i].created_at.getTime();
  // contact 3–20h after receipt, clamped to <= now
  const at = Math.min(received + (3 + (i % 6) * 3) * 3_600_000, NOW - 3_600_000);
  if (await event(current[i].id, "Contacted", at)) contacted++;
}

await sql.end();
console.log(`seeded: backdated import ${BACKDATED_REF} with ${made} leads (${closes} closed), contacted ${contacted} current leads`);
