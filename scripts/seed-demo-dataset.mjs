// Full demo dataset generator (DEMO ONLY — not the real seed). Wipes the tenant's
// partners + leads + coverage + imports and rebuilds a rich ~2-year dataset that
// exercises every angle of the app: ZIP overrides vs state fallback vs unmatched
// gaps, MLS removals varying by lead-source quality, the full lead lifecycle
// (contact time / close / dead / backlog), manual assignments, repeat sellers,
// and partner-health variation. Deterministic (seeded PRNG). Every event <= now.
//
//   node scripts/seed-demo-dataset.mjs        # wipe + rebuild
//   node scripts/seed-demo-dataset.mjs --wipe # wipe only
// Run with .env.local loaded. Preserves the admin user + tenant.

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const WIPE_ONLY = process.argv.includes("--wipe");

// ── seeded PRNG (mulberry32) — reproducible ──────────────────────────────────
let _s = 0x9e3779b9;
const rnd = () => {
  _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p) => rnd() < p;
const HOUR = 3_600_000, DAY = 86_400_000, WEEK = 7 * DAY;

const [{ nw }] = await sql`select now() nw`;
const NOW = nw.getTime();
const [tenant] = await sql`select id from tenants order by created_at limit 1`;
const [admin] = await sql`select id from users where tenant_id=${tenant.id} and role='admin' order by created_at limit 1`;
const ADMIN_ID = admin?.id ?? null;

// ── wipe (FK-safe order) ─────────────────────────────────────────────────────
async function wipe() {
  const T = tenant.id;
  await sql`delete from lead_status_history where tenant_id=${T}`;
  await sql`delete from lead_notes where tenant_id=${T}`;
  // WP-TSK-4: lead_tasks references leads — must go before the leads wipe below.
  await sql`delete from lead_tasks where tenant_id=${T}`;
  // WP-TAG-1: the junction references BOTH leads and tags, so it goes first; tags
  // themselves reference only the tenant and can go with it.
  await sql`delete from lead_tags where tenant_id=${T}`;
  await sql`delete from tags where tenant_id=${T}`;
  await sql`delete from listing_checks where tenant_id=${T}`;
  await sql`delete from events where tenant_id=${T}`;
  // audit_log is append-only evidence (ACT-04 / F-05) — the seeder never deletes it.
  await sql`delete from leads where tenant_id=${T}`;
  await sql`delete from coverage_zips where tenant_id=${T}`;
  await sql`delete from state_rules where tenant_id=${T}`;
  await sql`delete from uploads where tenant_id=${T}`;
  await sql`delete from partners where tenant_id=${T}`;
  console.log("wiped tenant partners/leads/coverage/imports");
}
await wipe();
if (WIPE_ONLY) { await sql.end(); console.log("done (wipe only)"); process.exit(0); }

// ── reference data ───────────────────────────────────────────────────────────
const PALETTE = ["#f4c95d","#b9c4d6","#8fbfe8","#f2a0b6","#e5c07b","#e8927c","#7fd1c8","#9cc69b","#c9a0dc",
  "#a3c4a0","#e0b0d5","#c7b299","#8fc6d1","#e8b98a"];

const ZIP3 = {
  TX:["750","752","770","772","760","787","782"], FL:["320","331","333","334","326"], GA:["300","303","305","310"],
  NC:["272","275","280","282"], AZ:["850","852","853","857"], TN:["370","372","373","381"], OH:["432","440","441","452"],
  IN:["462","465","467"], MO:["631","640","641","652"], SC:["290","292","294"], AL:["350","352","360"], NV:["889","891","893"],
  CO:["800","802","806"], WA:["980","982","990"], OR:["970","972","973"], NJ:["070","073","080"], VA:["220","232","236"],
  PA:["150","152","190"], MI:["480","482","490"], KY:["402","404","410"], LA:["700","703","708"], MS:["386","390","394"],
  OK:["730","740","744"], KS:["660","666","672"], AR:["717","720","722"],
  NM:["870","873","880"], WV:["247","250","260"], MT:["590","591","597"], WY:["820","826","829"], ID:["832","836"], NE:["680","683","687"],
};
const CITY = {
  TX:"Dallas",FL:"Orlando",GA:"Atlanta",NC:"Charlotte",AZ:"Phoenix",TN:"Nashville",OH:"Columbus",IN:"Indianapolis",
  MO:"Kansas City",SC:"Columbia",AL:"Birmingham",NV:"Las Vegas",CO:"Denver",WA:"Seattle",OR:"Portland",NJ:"Newark",
  VA:"Richmond",PA:"Philadelphia",MI:"Detroit",KY:"Louisville",LA:"New Orleans",MS:"Jackson",OK:"Tulsa",KS:"Wichita",
  AR:"Little Rock",NM:"Santa Fe",WV:"Charleston",MT:"Billings",WY:"Cheyenne",ID:"Boise",NE:"Omaha",
};
// state -> pick weight (covered states higher; gap states low but non-zero)
const STATE_WEIGHT = { TX:14,FL:12,GA:8,NC:7,AZ:6,TN:6,OH:6,SC:5,AL:5,MO:5,IN:4,NV:4,CO:4,KY:4,LA:4,WA:5,OR:3,PA:5,MI:5,VA:5,NJ:4,KS:3,AR:3,MS:3,OK:4, NM:2,WV:2,MT:1,WY:1,ID:1,NE:2 };
const WEIGHTED_STATES = Object.entries(STATE_WEIGHT).flatMap(([s, w]) => Array(w).fill(s));

const ARCH = {
  A:{contactProb:.92,contactHours:3,closeProb:.34,deadProb:.20},
  B:{contactProb:.82,contactHours:10,closeProb:.26,deadProb:.24},
  C:{contactProb:.70,contactHours:24,closeProb:.20,deadProb:.28},
  D:{contactProb:.52,contactHours:60,closeProb:.14,deadProb:.30},
  E:{contactProb:.40,contactHours:36,closeProb:.12,deadProb:.20},
};
// 14 partners: name, states owned, archetype, status, lastLoginDaysAgo
const PARTNERS = [
  { name:"Lone Star Holdings", states:["TX","OK"], arch:"A", status:"active", login:1 },
  { name:"Sunshine State Buyers", states:["FL"], arch:"B", status:"active", login:2 },
  { name:"Peach REI Group", states:["GA","AL"], arch:"A", status:"active", login:1 },
  { name:"Tar Heel Properties", states:["NC","SC"], arch:"B", status:"active", login:3 },
  { name:"Desert Capital", states:["AZ","NV"], arch:"C", status:"active", login:5 },
  { name:"Volunteer Homes", states:["TN","KY"], arch:"D", status:"active", login:14 },
  { name:"Buckeye Investments", states:["OH","IN"], arch:"B", status:"active", login:2 },
  { name:"Show-Me Deals", states:["MO","KS","AR"], arch:"C", status:"active", login:6 },
  { name:"Bayou Acquisitions", states:["LA","MS"], arch:"D", status:"active", login:21 },
  { name:"Rocky Mountain REI", states:["CO"], arch:"C", status:"active", login:8 },
  { name:"Cascade Property Group", states:["WA","OR"], arch:"A", status:"active", login:1 },
  { name:"Keystone Buyers", states:["PA"], arch:"C", status:"invited", login:null },
  { name:"Great Lakes Homes", states:["MI"], arch:"E", status:"active", login:40 },
  { name:"Old Dominion REI", states:["VA","NJ"], arch:"B", status:"active", login:4 },
];
// ZIP overrides: [zip5, partnerIndex] — beat the state fallback / cover a gap corner
const ZIP_OVERRIDES = [
  ["79901", 4], ["79902", 4], ["79903", 4], // El Paso TX -> Desert Capital (TX is Lone Star's)
  ["40201", 6], ["40202", 6],               // Louisville KY -> Buckeye (KY is Volunteer's)
  ["82001", 9],                             // Cheyenne WY -> Rocky Mountain (WY otherwise a gap)
  ["87501", 0],                             // Santa Fe NM -> Lone Star (NM otherwise a gap)
];
const SOURCES = [
  { name:"Zillow FSBO", weight:22, removal:0.12, closeMult:1.2 },
  { name:"Facebook Ads", weight:20, removal:0.35, closeMult:0.8 },
  { name:"PPC Google", weight:18, removal:0.20, closeMult:1.0 },
  { name:"Cold Call List", weight:15, removal:0.60, closeMult:0.5 },
  { name:"Direct Mail", weight:15, removal:0.18, closeMult:1.1 },
  { name:"Referral", weight:10, removal:0.06, closeMult:1.6 },
];
const WEIGHTED_SOURCES = SOURCES.flatMap((s) => Array(s.weight).fill(s));
const FIRST = ["James","Mary","John","Patricia","Robert","Jennifer","Michael","Linda","David","Barbara","William","Susan","Richard","Karen","Joseph","Nancy","Thomas","Lisa","Chris","Sandra","Daniel","Ashley","Paul","Kimberly","Mark","Donna"];
const LAST = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Clark"];
const STREETS = ["Oak","Maple","Cedar","Pine","Elm","Washington","Lake","Hill","Park","Sunset","Ridge","Meadow","River","Highland","Franklin","Church","Main","Willow"];
const SUFF = ["St","Ave","Dr","Ln","Rd","Ct","Blvd","Way"];

// ── partners + coverage ──────────────────────────────────────────────────────
const partnerRows = PARTNERS.map((p, i) => ({
  tenant_id: tenant.id, ref_id: `PR-${String(i + 1).padStart(3, "0")}`, name: p.name, color: PALETTE[i],
  email: `${p.name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@example.com`,
  status: p.status,
  activated_at: p.status === "active" ? new Date(NOW - int(60, 700) * DAY).toISOString() : null,
  invited_at: p.status !== "not_invited" ? new Date(NOW - int(60, 720) * DAY).toISOString() : null,
  last_portal_login_at: p.login != null ? new Date(NOW - p.login * DAY).toISOString() : null,
}));
const insertedPartners = await sql`insert into partners ${sql(partnerRows, "tenant_id","ref_id","name","color","email","status","activated_at","invited_at","last_portal_login_at")} returning id`;
const pid = insertedPartners.map((r) => r.id);

const stateRuleRows = [];
PARTNERS.forEach((p, i) => p.states.forEach((st) => stateRuleRows.push({ tenant_id: tenant.id, state: st, partner_id: pid[i] })));
await sql`insert into state_rules ${sql(stateRuleRows, "tenant_id","state","partner_id")}`;

const zipRows = ZIP_OVERRIDES.map(([zip, i]) => ({ tenant_id: tenant.id, zip5: zip, partner_id: pid[i], version: 1 }));
await sql`insert into coverage_zips ${sql(zipRows, "tenant_id","zip5","partner_id","version")}`;

// coverage lookup for assignment
const stateMap = new Map(stateRuleRows.map((r) => [r.state, r.partner_id]));
const zipMap = new Map(ZIP_OVERRIDES.map(([zip, i]) => [zip, pid[i]]));

// ── imports (weekly recent, sparser older, ~2 years) ─────────────────────────
const importDates = [];
for (let w = 0; w < 26; w++) importDates.push(NOW - w * WEEK - int(0, 1) * DAY);       // weekly, last 6 mo (newest ~today)
for (let w = 29; w <= 104; w += 3) importDates.push(NOW - w * WEEK - int(0, 3) * DAY); // ~every 3 wks, back to 2 yrs
importDates.sort((a, b) => a - b); // oldest first
// Size each import so the total lands just under 1000 across ALL imports (no
// global cap that would starve the newest weeks). Recent weeks a touch heavier.

const uploadRows = importDates.map((d, i) => {
  const yy = String(new Date(d).getUTCFullYear() % 100).padStart(2, "0"); // ref-ID v2 (ADR-0019)
  return { tenant_id: tenant.id, ref_id: `IM-${yy}-${String(i + 1).padStart(3, "0")}`, filename: `week-${new Date(d).toISOString().slice(0, 10)}.xlsx`, status: "processed", row_count: 0, created_at: new Date(d).toISOString() };
});
const insertedUploads = await sql`insert into uploads ${sql(uploadRows, "tenant_id","ref_id","filename","status","row_count","created_at")} returning id`;
const uploadId = insertedUploads.map((r) => r.id);

// ── generate leads ───────────────────────────────────────────────────────────
let seq = 0;
const leads = [];       // db rows
const leadMeta = [];    // {partnerId, arch, source, receivedMs, kept, manual}
for (let u = 0; u < importDates.length; u++) {
  const base = importDates[u];
  const recent = u >= importDates.length - 26; // sorted oldest-first
  const n = (recent ? 19 : 15) + int(0, 2); // max 26*21 + 26*17 = 988 <= 1000
  for (let k = 0; k < n; k++) {
    // Spread received dates around the import; clamp to just-before-now (never
    // skip) so the newest import still populates the current week/month.
    const received = Math.min(base + int(0, 4) * DAY + int(0, 18) * HOUR, NOW - int(1, 6) * HOUR);
    const st = pick(WEIGHTED_STATES);
    const zip = pick(ZIP3[st]) + String(int(0, 99)).padStart(2, "0");
    const source = pick(WEIGHTED_SOURCES);
    const removed = chance(source.removal);
    // resolve coverage: zip override -> state fallback -> unmatched
    let partnerId = zipMap.get(zip) ?? stateMap.get(st) ?? null;
    let match = zipMap.get(zip) ? "zip" : stateMap.get(st) ? "state_fallback" : "none";
    let manualPartner = null, manualAt = null;
    // manual-assign ~35% of would-be unmatched (kept only)
    if (!removed && partnerId === null && chance(0.35)) {
      manualPartner = pid[int(0, PARTNERS.length - 1)];
      manualAt = new Date(Math.min(received + int(1, 10) * DAY, NOW - HOUR)).toISOString();
    }
    const effPartner = manualPartner ?? partnerId;
    const prev = Boolean(!removed && effPartner && chance(0.06));
    seq += 1;
    const yy = String(new Date(received).getUTCFullYear() % 100).padStart(2, "0"); // ref-ID v2 (ADR-0019)
    const ref = `LD-${yy}-${String(seq).padStart(5, "0")}`;
    leads.push({
      tenant_id: tenant.id, ref_id: ref, upload_id: uploadId[u], dedupe_key: `demo|${ref}`, raw_json: sql.json({ demo: true }),
      campaign: source.name, address: `${int(100, 9999)} ${pick(STREETS)} ${pick(SUFF)}`, city: CITY[st], state: st, zip,
      seller_first: pick(FIRST), seller_last: pick(LAST),
      partner_id: partnerId, match_method: match, mls_status: removed ? "removed" : "kept",
      mls_reason: removed ? "Listed on MLS" : null,
      previously_matched: prev, original_partner_id: prev ? effPartner : null,
      first_matched_at: prev ? new Date(received - int(3, 30) * WEEK).toISOString() : null,
      manual_partner_id: manualPartner, manual_assigned_at: manualAt, manual_assigned_by: manualPartner ? ADMIN_ID : null,
      manual_reason: manualPartner ? "covers this metro off-book" : null,
      created_at: new Date(received).toISOString(),
    });
    const archIdx = effPartner ? pid.indexOf(effPartner) : -1;
    leadMeta.push({ effPartner, arch: archIdx >= 0 ? PARTNERS[archIdx].arch : null, source, receivedMs: received, kept: !removed });
  }
}

// per-import row_count
const countByUpload = new Map();
for (const l of leads) countByUpload.set(l.upload_id, (countByUpload.get(l.upload_id) ?? 0) + 1);
for (const [uid, c] of countByUpload) await sql`update uploads set row_count=${c} where id=${uid}`;

// bulk insert leads (chunked)
const LEAD_COLS = ["tenant_id","ref_id","upload_id","dedupe_key","raw_json","campaign","address","city","state","zip","seller_first","seller_last","partner_id","match_method","mls_status","mls_reason","previously_matched","original_partner_id","first_matched_at","manual_partner_id","manual_assigned_at","manual_assigned_by","manual_reason","created_at"];
const leadIds = [];
for (let i = 0; i < leads.length; i += 200) {
  const chunk = leads.slice(i, i + 200);
  const res = await sql`insert into leads ${sql(chunk, ...LEAD_COLS)} returning id`;
  res.forEach((r) => leadIds.push(r.id));
}

// ── lifecycle status history for kept + owned (routed or manually assigned) ──
const history = [];
let closed = 0, dead = 0, contacted = 0, untouched = 0, unmatchedBacklog = 0;
const clampNow = (t) => Math.min(t, NOW - HOUR);
const push = (i, status, at) => history.push({ tenant_id: tenant.id, lead_id: leadIds[i], status, created_at: new Date(clampNow(at)).toISOString() });
for (let i = 0; i < leads.length; i++) {
  const m = leadMeta[i];
  if (!m.kept) continue;
  if (!m.effPartner) { unmatchedBacklog++; continue; } // still unmatched — no status
  const a = ARCH[m.arch];
  const R = m.receivedMs;
  const ageDays = (NOW - R) / DAY;
  // Untouched = only RECENT uncontacted leads (the real backlog). Older
  // uncontacted leads aged out (written off as Dead), never sit New for years.
  if (!chance(a.contactProb)) {
    if (ageDays > 25) { push(i, "Dead", R + int(15, 50) * DAY); dead++; }
    else untouched++;
    continue;
  }
  const contactAt = R + a.contactHours * (0.4 + 1.2 * rnd()) * HOUR;
  if (contactAt > NOW) { untouched++; continue; } // contact still in the future → recent New
  push(i, "Contacted", contactAt);
  contacted++;
  const roll = rnd();
  const effClose = Math.min(0.7, a.closeProb * m.source.closeMult);
  if (roll < effClose) {
    let reached = false;
    for (const [status, at] of [["Appointment", contactAt + int(2, 8) * DAY], ["Under contract", contactAt + int(9, 20) * DAY], ["Closed", contactAt + int(18, 40) * DAY]]) {
      if (at > NOW) break;
      push(i, status, at);
      if (status === "Closed") { closed++; reached = true; }
    }
    if (!reached && ageDays > 50) { push(i, "Closed", contactAt + int(20, 45) * DAY); closed++; } // old winner, force-resolve
  } else if (roll < effClose + a.deadProb) {
    push(i, "Dead", contactAt + int(3, 18) * DAY); dead++;
  } else {
    // in progress — but an old stalled lead resolves (written off)
    if (ageDays > 45) { push(i, "Dead", contactAt + int(10, 40) * DAY); dead++; }
    else if (chance(0.5)) push(i, "Appointment", contactAt + int(2, 10) * DAY);
  }
}
for (let i = 0; i < history.length; i += 300) {
  await sql`insert into lead_status_history ${sql(history.slice(i, i + 300), "tenant_id","lead_id","status","created_at")}`;
}

// ── demo tags (WP-TAG-1 / TAG-01) ────────────────────────────────────────────────
// Three workflow labels an operator would plausibly keep, spread across a slice of the
// kept leads so the chips, the "+n" cap on board cards, and the tag filter all have
// something real to show. Colors are PALETTE KEYS (lib/tokens TAG_PALETTE), never hex —
// the chip renderer resolves them to semantic tokens (PRN-12). `added_by_user_id` needs a
// real user, so the whole block is skipped (loudly) when the tenant has no admin.
const DEMO_TAGS = [
  { name: "Probate", color: "teal", every: 7 },      // ~14% of kept leads
  { name: "Follow-up", color: "blue", every: 5 },    // ~20%
  { name: "Cash buyer ask", color: "plum", every: 11 }, // ~9%
];
if (ADMIN_ID) {
  const tagIds = [];
  for (const t of DEMO_TAGS) {
    const [row] = await sql`
      insert into tags (tenant_id, name, color) values (${tenant.id}, ${t.name}, ${t.color}) returning id`;
    tagIds.push(row.id);
  }
  // Deterministic spread (every Nth kept lead) rather than random, so a reseed produces the
  // same demo — the same discipline the rest of this script's seeded RNG follows.
  const attachRows = [];
  for (let i = 0; i < leads.length; i++) {
    if (!leadMeta[i].kept) continue;
    DEMO_TAGS.forEach((t, k) => {
      if (i % t.every === 0) {
        attachRows.push({ tenant_id: tenant.id, lead_id: leadIds[i], tag_id: tagIds[k], added_by_user_id: ADMIN_ID });
      }
    });
  }
  for (let i = 0; i < attachRows.length; i += 300) {
    await sql`insert into lead_tags ${sql(attachRows.slice(i, i + 300), "tenant_id", "lead_id", "tag_id", "added_by_user_id")}`;
  }
  console.log(`seeded ${DEMO_TAGS.length} demo tags across ${attachRows.length} lead attachments`);
} else {
  console.log("skipped demo tags — no admin user for this tenant (lead_tags.added_by_user_id)");
}

// ── demo lead tasks (WP-TSK-4 DoD, amended from WP-TSK-1) ────────────────────────
// Both streams get one overdue, one due-today, and one done task, attached to existing
// demo leads (never invented rows) — the same "both streams" shape the tenancy tests use.
// Admin tasks belong to the tenant's admin (ADMIN_ID, already resolved above). Partner
// tasks need a real Supabase-auth-backed portal user (users.id mirrors the auth user id
// — this script, unlike the app, cannot fabricate one), so they only seed when a partner
// portal login was already provisioned for this tenant (scripts/provision-partner.ts);
// otherwise they're skipped with a console note rather than faked.
const ownedKeptIdx = [];
for (let i = leads.length - 1; i >= 0 && ownedKeptIdx.length < 24; i--) {
  const m = leadMeta[i];
  if (m.kept && m.effPartner) ownedKeptIdx.push(i);
}

async function seedTaskTrio(authorUserId, authorRole, leadIdxs, titles) {
  // [dueOffsetDays, doneOffsetDaysOrNull] — overdue / due-today / done, in that order.
  const PLAN = [[-3, null], [0, null], [-2, -1]];
  for (let i = 0; i < PLAN.length; i++) {
    const [dueOffset, doneOffset] = PLAN[i];
    const dueOn = new Date(NOW + dueOffset * DAY).toISOString().slice(0, 10);
    const doneAt = doneOffset === null ? null : new Date(NOW + doneOffset * DAY).toISOString();
    await sql`
      insert into lead_tasks (tenant_id, lead_id, author_user_id, author_role, assigned_to_user_id, title, due_on, done_at)
      values (${tenant.id}, ${leadIds[leadIdxs[i]]}, ${authorUserId}, ${authorRole}, ${authorUserId}, ${titles[i]}, ${dueOn}, ${doneAt})`;
  }
}

if (ADMIN_ID && ownedKeptIdx.length >= 3) {
  await seedTaskTrio(ADMIN_ID, "admin", ownedKeptIdx.slice(0, 3), [
    "Call seller to schedule walkthrough",
    "Send comps + preliminary offer range",
    "Initial contact — left voicemail",
  ]);
  console.log("seeded 3 admin-stream demo tasks");
} else {
  console.log("skipped admin-stream demo tasks — no admin user or no owned/kept leads");
}

const [partnerUser] = await sql`select id, partner_id from users where tenant_id=${tenant.id} and role='partner' order by created_at limit 1`;
if (partnerUser) {
  const partnerLeadIdx = ownedKeptIdx.filter((i) => leadMeta[i].effPartner === partnerUser.partner_id).slice(0, 3);
  if (partnerLeadIdx.length >= 3) {
    await seedTaskTrio(partnerUser.id, "partner", partnerLeadIdx, [
      "Follow up on signed access agreement",
      "Re-check MLS status before offer",
      "Confirm access window with seller",
    ]);
    console.log("seeded 3 partner-stream demo tasks");
  } else {
    console.log("skipped partner-stream demo tasks — the provisioned partner user owns fewer than 3 kept leads");
  }
} else {
  console.log("skipped partner-stream demo tasks — no partner portal user provisioned for this tenant (run scripts/provision-partner.ts)");
}

await sql.end();
const removedCount = leads.filter((l) => l.mls_status === "removed").length;
const manualCount = leads.filter((l) => l.manual_partner_id).length;
console.log(`DONE — ${PARTNERS.length} partners, ${leads.length} leads across ${importDates.length} imports (${new Date(importDates[0]).toISOString().slice(0,10)} → today).`);
console.log(`  removed(MLS): ${removedCount} · manual-assigned: ${manualCount} · unmatched backlog: ${unmatchedBacklog}`);
console.log(`  lifecycle: contacted ${contacted} · closed ${closed} · dead ${dead} · untouched(new) ${untouched} · history rows ${history.length}`);
