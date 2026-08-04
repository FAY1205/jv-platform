// Event-scoped performance (ANA-02). PURE — no I/O (PRN-01). Each metric lands
// in the period its EVENT occurred (a lead given last week but closed this week
// is a close THIS week). Counts only — a period close-rate would mix cohorts and
// can exceed 100%. Single home of these numbers (PRN-15).

export interface PerfLead {
  partnerId: string | null;
  campaign: string | null;
  mlsStatus: "kept" | "removed";
  receivedAt: string;
  firstTouchAt: string | null;
  closedAt: string | null;
  currentStatus: string;
}

export interface PeriodRangeLite {
  start: Date;
  end: Date;
}

export interface PartnerPerf {
  partnerId: string;
  given: number;
  untouched: number;
  contacted: number;
  closed: number;
  avgTimeToContactHours: number | null;
}

export interface SourcePerf {
  campaign: string;
  imported: number;
  removed: number;
  closed: number;
  removalRate: number;
}

const HOUR = 3_600_000;
const NEW = "New";
const UNATTRIBUTED = "Unattributed";

const inRange = (iso: string | null, r: PeriodRangeLite): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.start.getTime() && t < r.end.getTime();
};

export function partnerPerformance(range: PeriodRangeLite, leads: readonly PerfLead[]): PartnerPerf[] {
  const acc = new Map<string, { given: number; untouched: number; contacted: number; closed: number; touchSumH: number }>();
  for (const lead of leads) {
    if (lead.partnerId === null) continue;
    // Removed (MLS-listed) leads still carry a pipeline partner_id but were never
    // delivered to work — they are not part of a partner's performance.
    if (lead.mlsStatus !== "kept") continue;
    const a = acc.get(lead.partnerId) ?? { given: 0, untouched: 0, contacted: 0, closed: 0, touchSumH: 0 };
    const given = inRange(lead.receivedAt, range);
    if (given) {
      a.given += 1;
      if (lead.currentStatus === NEW) a.untouched += 1;
    }
    if (inRange(lead.firstTouchAt, range)) {
      a.contacted += 1;
      a.touchSumH += (new Date(lead.firstTouchAt!).getTime() - new Date(lead.receivedAt).getTime()) / HOUR;
    }
    if (inRange(lead.closedAt, range)) a.closed += 1;
    acc.set(lead.partnerId, a);
  }
  return [...acc.entries()]
    .map(([partnerId, a]) => ({
      partnerId,
      given: a.given,
      untouched: a.untouched,
      contacted: a.contacted,
      closed: a.closed,
      avgTimeToContactHours: a.contacted === 0 ? null : Math.round((a.touchSumH / a.contacted) * 10) / 10,
    }))
    .sort((x, y) => y.given - x.given || y.contacted - x.contacted || x.partnerId.localeCompare(y.partnerId));
}

export function sourcePerformance(range: PeriodRangeLite, leads: readonly PerfLead[]): SourcePerf[] {
  const acc = new Map<string, { imported: number; removed: number; closed: number }>();
  for (const lead of leads) {
    const key = lead.campaign && lead.campaign.trim() ? lead.campaign.trim() : UNATTRIBUTED;
    const a = acc.get(key) ?? { imported: 0, removed: 0, closed: 0 };
    if (inRange(lead.receivedAt, range)) {
      a.imported += 1;
      if (lead.mlsStatus === "removed") a.removed += 1;
    }
    if (inRange(lead.closedAt, range)) a.closed += 1;
    acc.set(key, a);
  }
  return [...acc.entries()]
    .map(([campaign, a]) => ({
      campaign,
      imported: a.imported,
      removed: a.removed,
      closed: a.closed,
      removalRate: a.imported === 0 ? 0 : a.removed / a.imported,
    }))
    .sort((x, y) => y.imported - x.imported || x.campaign.localeCompare(y.campaign));
}
