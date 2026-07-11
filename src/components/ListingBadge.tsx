import { Badge, type BadgeVariant } from "./Badge";

// LST-03: a labeled listing-check flag + an optional verify link. The label always
// carries words (never color alone, PRN-14). LinkOnly yields "Unknown" + a link.

export type ListingStatus = "pending" | "yes" | "no" | "unknown";

const LABEL: Record<ListingStatus, string> = {
  pending: "Not checked",
  yes: "Possibly listed",
  no: "Not listed",
  unknown: "Unknown — verify",
};
const VARIANT: Record<ListingStatus, BadgeVariant> = {
  pending: "neutral",
  yes: "warn",
  no: "success",
  unknown: "outline",
};

export function ListingBadge({ status, link }: { status: ListingStatus; link: string | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-ink hover:underline">
          Check listing ↗
        </a>
      )}
    </span>
  );
}
