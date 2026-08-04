import type { ScreenKey } from "./prompt";

// Map the current admin route to a screen-catalog key (design §4: "explain this
// screen" + contextual chips). Detail routes get their *_detail key; a lead detail
// has no catalog key so it degrades to the leads screen. Pure — no window/router.
export function screenForPath(pathname: string): ScreenKey | undefined {
  const path = pathname.split("?")[0].split("#")[0];
  if (path === "/" || path === "/dashboard") return "dashboard";
  const seg = path.split("/").filter(Boolean); // ["imports","IM-26-004"]
  const top = seg[0];
  const hasChild = seg.length > 1;
  switch (top) {
    case "leads": return "leads";
    case "unmatched": return "unmatched";
    case "imports": return hasChild ? "import_detail" : "imports";
    case "partners": return hasChild ? "partner_detail" : "partners";
    case "coverage": return "coverage";
    case "activity": return "activity";
    case "rules": return "rules";
    case "settings": return "settings";
    case "upload": return "upload";
    default: return undefined;
  }
}
