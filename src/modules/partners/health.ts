// Partner health (ANA-02). PURE — `now` injected, never read (PRN-01). Turns a
// partner's owned leads into accountability signals: untouched backlog, how long
// the oldest has sat, and average time-to-first-touch.

export interface HealthLead {
  partnerId: string;
  receivedAt: string;
  /** The lead's current workflow status (New, Contacted, … Closed). */
  currentStatus: string;
  /** When it first moved off "New", or null if still untouched. */
  firstTouchAt: string | null;
}

export interface PartnerHealth {
  owned: number;
  untouched: number;
  oldestUntouchedDays: number;
  /** Average hours from received → first action, over touched leads (null if none). */
  avgFirstTouchHours: number | null;
}

const NEW = "New";
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function computePartnerHealth(now: Date, leads: readonly HealthLead[]): Map<string, PartnerHealth> {
  const acc = new Map<string, { owned: number; untouched: number; oldestUntouchedMs: number; touchSumH: number; touched: number }>();

  for (const lead of leads) {
    const a = acc.get(lead.partnerId) ?? { owned: 0, untouched: 0, oldestUntouchedMs: 0, touchSumH: 0, touched: 0 };
    a.owned += 1;
    const received = new Date(lead.receivedAt).getTime();
    if (lead.currentStatus === NEW) {
      a.untouched += 1;
      a.oldestUntouchedMs = Math.max(a.oldestUntouchedMs, now.getTime() - received);
    }
    if (lead.firstTouchAt) {
      a.touchSumH += (new Date(lead.firstTouchAt).getTime() - received) / HOUR;
      a.touched += 1;
    }
    acc.set(lead.partnerId, a);
  }

  const out = new Map<string, PartnerHealth>();
  for (const [partnerId, a] of acc) {
    out.set(partnerId, {
      owned: a.owned,
      untouched: a.untouched,
      oldestUntouchedDays: Math.floor(a.oldestUntouchedMs / DAY),
      avgFirstTouchHours: a.touched === 0 ? null : Math.round((a.touchSumH / a.touched) * 10) / 10,
    });
  }
  return out;
}
