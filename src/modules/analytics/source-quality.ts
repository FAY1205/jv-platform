// Lead-source quality (ANA-02). PURE — no I/O (PRN-01). A campaign's removal
// rate (leads discarded as MLS-listed) is the money leak; this is the single
// home of that number (PRN-15).

export interface SourceLead {
  campaign: string | null;
  mlsStatus: "kept" | "removed";
}

export interface CampaignQuality {
  campaign: string;
  total: number;
  kept: number;
  removed: number;
  removalRate: number;
}

const UNATTRIBUTED = "Unattributed";

export function campaignQuality(leads: readonly SourceLead[]): CampaignQuality[] {
  const byCampaign = new Map<string, { total: number; removed: number }>();
  for (const lead of leads) {
    const key = lead.campaign && lead.campaign.trim() ? lead.campaign.trim() : UNATTRIBUTED;
    const agg = byCampaign.get(key) ?? { total: 0, removed: 0 };
    agg.total += 1;
    if (lead.mlsStatus === "removed") agg.removed += 1;
    byCampaign.set(key, agg);
  }

  return [...byCampaign.entries()]
    .map(([campaign, { total, removed }]) => ({
      campaign,
      total,
      kept: total - removed,
      removed,
      removalRate: total === 0 ? 0 : removed / total,
    }))
    .sort((a, b) => b.total - a.total || a.campaign.localeCompare(b.campaign));
}
