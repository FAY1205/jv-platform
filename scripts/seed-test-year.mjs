// One-year TEST dataset generator (DEV/TEST ONLY — SEC-07 fake data; NOT the real
// seed). Wipes the tenant's operational data (partners, leads, coverage, imports,
// status history, notes, listing checks, events) and rebuilds a rich ONE-YEAR
// dataset with DAILY imports (3–20 leads/day, random) that exercises every angle
// of the app: ZIP overrides vs state fallback vs unmatched gaps, MLS removals by
// source quality, the full lead lifecycle (contact time / close / dead / backlog),
// manual assignments, repeat sellers, partner-health variation, admin notes, and a
// spread of audit-log activity — so dashboard KPIs, prior-window deltas, the county
// map, imports, and activity all populate. Deterministic (seeded PRNG). Every event
// <= now. Preserves the tenant + users; audit_log is append-only (never deleted).
//
//   node --env-file=.env.local scripts/seed-test-year.mjs        # wipe + rebuild
//   node --env-file=.env.local scripts/seed-test-year.mjs --wipe # wipe only
//
// Run AFTER `pnpm db:seed` (tenant + config) and after provisioning the admin
// (so notes/audit have a real actor; falls back to system/null if absent).

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const WIPE_ONLY = process.argv.includes("--wipe");

// ── seeded PRNG (mulberry32) — reproducible ──────────────────────────────────
let _s = 0x1a2b3c4d;
const rnd = () => {
  _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p) => rnd() < p;
const HOUR = 3_600_000, DAY = 86_400_000;

const [{ nw }] = await sql`select now() nw`;
const NOW = nw.getTime();
const [tenant] = await sql`select id from tenants order by created_at limit 1`;
if (!tenant) { console.error("No tenant — run `pnpm db:seed` first."); await sql.end(); process.exit(1); }
const [admin] = await sql`select id from users where tenant_id=${tenant.id} and role='admin' order by created_at limit 1`;
const ADMIN_ID = admin?.id ?? null;

// ── wipe (FK-safe order; preserves tenant + users; audit_log is append-only) ──
async function wipe() {
  const T = tenant.id;
  await sql`delete from lead_status_history where tenant_id=${T}`;
  await sql`delete from lead_notes where tenant_id=${T}`;
  await sql`delete from listing_checks where tenant_id=${T}`;
  await sql`delete from leads where tenant_id=${T}`;
  await sql`delete from coverage_zips where tenant_id=${T}`;
  await sql`delete from state_rules where tenant_id=${T}`;
  await sql`delete from uploads where tenant_id=${T}`;
  await sql`delete from partners where tenant_id=${T}`;
  console.log("wiped tenant partners/leads/coverage/imports/notes (audit_log preserved — append-only)");
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
const STATE_WEIGHT = { TX:14,FL:12,GA:8,NC:7,AZ:6,TN:6,OH:6,SC:5,AL:5,MO:5,IN:4,NV:4,CO:4,KY:4,LA:4,WA:5,OR:3,PA:5,MI:5,VA:5,NJ:4,KS:3,AR:3,MS:3,OK:4, NM:2,WV:2,MT:1,WY:1,ID:1,NE:2 };
const WEIGHTED_STATES = Object.entries(STATE_WEIGHT).flatMap(([s, w]) => Array(w).fill(s));

const ARCH = {
  A:{contactProb:.92,contactHours:3,closeProb:.34,deadProb:.20},
  B:{contactProb:.82,contactHours:10,closeProb:.26,deadProb:.24},
  C:{contactProb:.70,contactHours:24,closeProb:.20,deadProb:.28},
  D:{contactProb:.52,contactHours:60,closeProb:.14,deadProb:.30},
  E:{contactProb:.40,contactHours:36,closeProb:.12,deadProb:.20},
};
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
const REASONS = ["Relocating for work","Inherited property","Divorce","Downsizing","Facing foreclosure","Tired landlord","Job loss","Upgrading homes","Estate sale","Behind on payments"];
const MOTIV = ["High","Medium","Low","Very high","Testing the market"];
const TIMELINE = ["ASAP","30 days","60 days","90 days","Flexible","3-6 months"];
const phone = () => `(${int(200,989)}) ${int(200,989)}-${String(int(0,9999)).padStart(4,"0")}`;

// ── partners + coverage ──────────────────────────────────────────────────────
const partnerRows = PARTNERS.map((p, i) => ({
  tenant_id: tenant.id, ref_id: `JV-${String(i + 1).padStart(3, "0")}`, name: p.name, color: PALETTE[i],
  email: `${p.name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@example.com`,
  phone: phone(), status: p.status,
  activated_at: p.status === "active" ? new Date(NOW - int(60, 700) * DAY).toISOString() : null,
  invited_at: p.status !== "not_invited" ? new Date(NOW - int(60, 720) * DAY).toISOString() : null,
  last_portal_login_at: p.login != null ? new Date(NOW - p.login * DAY).toISOString() : null,
}));
const insertedPartners = await sql`insert into partners ${sql(partnerRows, "tenant_id","ref_id","name","color","email","phone","status","activated_at","invited_at","last_portal_login_at")} returning id`;
const pid = insertedPartners.map((r) => r.id);

const stateRuleRows = [];
PARTNERS.forEach((p, i) => p.states.forEach((st) => stateRuleRows.push({ tenant_id: tenant.id, state: st, partner_id: pid[i] })));
await sql`insert into state_rules ${sql(stateRuleRows, "tenant_id","state","partner_id")}`;
const zipRows = ZIP_OVERRIDES.map(([zip, i]) => ({ tenant_id: tenant.id, zip5: zip, partner_id: pid[i], version: 1 }));
await sql`insert into coverage_zips ${sql(zipRows, "tenant_id","zip5","partner_id","version")}`;

const stateMap = new Map(stateRuleRows.map((r) => [r.state, r.partner_id]));
const zipMap = new Map(ZIP_OVERRIDES.map(([zip, i]) => [zip, pid[i]]));

// ── imports: DAILY for the last 365 days (one upload per day) ────────────────
const DAYS = 365;
const importDates = [];
for (let d = DAYS - 1; d >= 0; d--) importDates.push(NOW - d * DAY); // oldest → newest (today last)

const uploadRows = importDates.map((d, i) => {
  const yy = String(new Date(d).getUTCFullYear() % 100).padStart(2, "0"); // ref-ID v2 (ADR-0019)
  const iso = new Date(d).toISOString();
  return { tenant_id: tenant.id, ref_id: `IM-${yy}-${String(i + 1).padStart(3, "0")}`, filename: `daily-${iso.slice(0, 10)}.xlsx`, status: "processed", row_count: 0, created_at: iso, distributed_at: iso };
});
const insertedUploads = await sql`insert into uploads ${sql(uploadRows, "tenant_id","ref_id","filename","status","row_count","created_at","distributed_at")} returning id`;
const uploadId = insertedUploads.map((r) => r.id);

// ── generate leads (3–20 per daily import) ───────────────────────────────────
let seq = 0;
const leads = [];
const leadMeta = [];
for (let u = 0; u < importDates.length; u++) {
  const base = importDates[u];
  const n = int(3, 20); // owner spec: 3–20 leads per daily upload, random
  for (let k = 0; k < n; k++) {
    // Received within the import's day; clamp to >= 1h ago so the distribution-hold
    // (10-min window) has released it and it is partner-visible even for "today".
    const received = Math.min(base + int(0, 20) * HOUR, NOW - int(1, 5) * HOUR);
    const st = pick(WEIGHTED_STATES);
    const zip = pick(ZIP3[st]) + String(int(0, 99)).padStart(2, "0");
    const source = pick(WEIGHTED_SOURCES);
    const removed = chance(source.removal);
    let partnerId = zipMap.get(zip) ?? stateMap.get(st) ?? null;
    let match = zipMap.get(zip) ? "zip" : stateMap.get(st) ? "state_fallback" : "none";
    let manualPartner = null, manualAt = null;
    if (!removed && partnerId === null && chance(0.35)) {
      manualPartner = pid[int(0, PARTNERS.length - 1)];
      manualAt = new Date(Math.min(received + int(1, 10) * DAY, NOW - HOUR)).toISOString();
    }
    const effPartner = manualPartner ?? partnerId;
    const prev = Boolean(!removed && effPartner && chance(0.06));
    seq += 1;
    const first = pick(FIRST), last = pick(LAST);
    const yy = String(new Date(received).getUTCFullYear() % 100).padStart(2, "0");
    const ref = `LD-${yy}-${String(seq).padStart(5, "0")}`;
    leads.push({
      tenant_id: tenant.id, ref_id: ref, upload_id: uploadId[u], dedupe_key: `test|${ref}`, raw_json: sql.json({ test: true }),
      campaign: source.name, address: `${int(100, 9999)} ${pick(STREETS)} ${pick(SUFF)}`, city: CITY[st], state: st, zip,
      seller_first: first, seller_last: last,
      phone: removed ? null : phone(),
      email: removed ? null : `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      reason_for_selling: removed ? null : pick(REASONS),
      motivation: removed ? null : pick(MOTIV),
      time_to_sell: removed ? null : pick(TIMELINE),
      partner_id: partnerId, match_method: match, mls_status: removed ? "removed" : "kept",
      mls_reason: removed ? "Listed on MLS" : null,
      previously_matched: prev, original_partner_id: prev ? effPartner : null,
      first_matched_at: prev ? new Date(received - int(3, 30) * 7 * DAY).toISOString() : null,
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
const LEAD_COLS = ["tenant_id","ref_id","upload_id","dedupe_key","raw_json","campaign","address","city","state","zip","seller_first","seller_last","phone","email","reason_for_selling","motivation","time_to_sell","partner_id","match_method","mls_status","mls_reason","previously_matched","original_partner_id","first_matched_at","manual_partner_id","manual_assigned_at","manual_assigned_by","manual_reason","created_at"];
const leadIds = [];
for (let i = 0; i < leads.length; i += 200) {
  const chunk = leads.slice(i, i + 200);
  const res = await sql`insert into leads ${sql(chunk, ...LEAD_COLS)} returning id`;
  res.forEach((r) => leadIds.push(r.id));
}

// ── lifecycle status history for kept + owned leads ──────────────────────────
const history = [];
let closed = 0, dead = 0, contacted = 0, untouched = 0, unmatchedBacklog = 0;
const clampNow = (t) => Math.min(t, NOW - HOUR);
const push = (i, status, at) => history.push({ tenant_id: tenant.id, lead_id: leadIds[i], status, created_at: new Date(clampNow(at)).toISOString() });
for (let i = 0; i < leads.length; i++) {
  const m = leadMeta[i];
  if (!m.kept) continue;
  if (!m.effPartner) { unmatchedBacklog++; continue; }
  const a = ARCH[m.arch];
  const R = m.receivedMs;
  const ageDays = (NOW - R) / DAY;
  if (!chance(a.contactProb)) {
    if (ageDays > 25) { push(i, "Dead", R + int(15, 50) * DAY); dead++; }
    else untouched++;
    continue;
  }
  const contactAt = R + a.contactHours * (0.4 + 1.2 * rnd()) * HOUR;
  if (contactAt > NOW) { untouched++; continue; }
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
    if (!reached && ageDays > 50) { push(i, "Closed", contactAt + int(20, 45) * DAY); closed++; }
  } else if (roll < effClose + a.deadProb) {
    push(i, "Dead", contactAt + int(3, 18) * DAY); dead++;
  } else {
    if (ageDays > 45) { push(i, "Dead", contactAt + int(10, 40) * DAY); dead++; }
    else if (chance(0.5)) push(i, "Appointment", contactAt + int(2, 10) * DAY);
  }
}
for (let i = 0; i < history.length; i += 300) {
  await sql`insert into lead_status_history ${sql(history.slice(i, i + 300), "tenant_id","lead_id","status","created_at")}`;
}

// ── admin notes (author = admin user, if provisioned) ────────────────────────
let noteCount = 0;
if (ADMIN_ID) {
  const NOTE_BODIES = ["Spoke with seller — motivated, wants a quick close.","Left a voicemail, will retry tomorrow.","Sent the offer, awaiting response.","Under contract paperwork sent to title.","Seller went quiet — following up next week.","Great lead, referral quality.","Numbers are tight but workable.","Scheduled a walkthrough for next week.","Competing offer on the table, moving fast.","Deal closed — smooth transaction."];
  const ownedKept = leadIds.filter((_, i) => leadMeta[i].kept && leadMeta[i].effPartner);
  const noteRows = [];
  for (let n = 0; n < 40 && ownedKept.length; n++) {
    const leadId = pick(ownedKept);
    noteRows.push({ tenant_id: tenant.id, lead_id: leadId, author_user_id: ADMIN_ID, author_role: "admin", body: pick(NOTE_BODIES), created_at: new Date(NOW - int(1, 300) * DAY).toISOString() });
  }
  if (noteRows.length) { await sql`insert into lead_notes ${sql(noteRows, "tenant_id","lead_id","author_user_id","author_role","body","created_at")}`; noteCount = noteRows.length; }
}

// ── audit_log activity (data + security mix; actor = admin) ───────────────────
// audit_log is append-only (INSERT allowed, UPDATE/DELETE blocked). Tie data
// events to real facts where possible so the admin Activity page reads natively.
const auditRows = [];
const addAudit = (action, entityType, entityRef, atMs) =>
  auditRows.push({ tenant_id: tenant.id, actor_user_id: ADMIN_ID, action, entity_type: entityType, entity_ref: entityRef, created_at: new Date(clampNow(atMs)).toISOString() });
// manual assignments → lead.manually_assigned (data), tied to the real lead + time
for (let i = 0; i < leads.length; i++) {
  if (leads[i].manual_partner_id && chance(0.6)) addAudit("lead.manually_assigned", "lead", leads[i].ref_id, new Date(leads[i].manual_assigned_at).getTime());
}
// coverage edits (security), invites (data), source-profile saves (security), session revokes (security)
for (let k = 0; k < 12; k++) addAudit("partner.coverage_updated", "partner", `JV-${String(int(1,14)).padStart(3,"0")}`, NOW - int(5, 350) * DAY);
for (let k = 0; k < 6; k++) addAudit("partner.invited", "partner", `JV-${String(int(1,14)).padStart(3,"0")}`, NOW - int(30, 360) * DAY);
for (let k = 0; k < 5; k++) addAudit("source_profile.saved", "source_profile", `InvestorFuse v1`, NOW - int(10, 340) * DAY);
for (let k = 0; k < 4; k++) addAudit("partner.session_revoked", "partner", `JV-${String(int(1,14)).padStart(3,"0")}`, NOW - int(2, 120) * DAY);
for (let k = 0; k < 8; k++) addAudit("lead.edited", "lead", pick(leads).ref_id, NOW - int(1, 300) * DAY);
if (auditRows.length) {
  for (let i = 0; i < auditRows.length; i += 200) {
    await sql`insert into audit_log ${sql(auditRows.slice(i, i + 200), "tenant_id","actor_user_id","action","entity_type","entity_ref","created_at")}`;
  }
}

await sql.end();
const removedCount = leads.filter((l) => l.mls_status === "removed").length;
const manualCount = leads.filter((l) => l.manual_partner_id).length;
console.log(`DONE — ${PARTNERS.length} partners, ${leads.length} leads across ${importDates.length} DAILY imports (${new Date(importDates[0]).toISOString().slice(0,10)} → today).`);
console.log(`  removed(MLS): ${removedCount} · manual-assigned: ${manualCount} · unmatched backlog: ${unmatchedBacklog}`);
console.log(`  lifecycle: contacted ${contacted} · closed ${closed} · dead ${dead} · untouched(new) ${untouched} · history rows ${history.length}`);
console.log(`  admin notes: ${noteCount} · audit_log activity: ${auditRows.length}${ADMIN_ID ? "" : " (no admin user found — notes/audit actor null)"}`);
