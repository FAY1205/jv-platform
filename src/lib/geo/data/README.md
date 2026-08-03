# ZIP → county crosswalk (`zip-county.json`)

WP-E (owner note #6) colors the maps at **county** level for the ZIPs a partner (or the house)
covers. `zip-county.json` maps each 5-digit ZIP to the 5-digit **county FIPS** the county geometry
(`public/geo/us-counties.json`) is keyed by:

```json
{ "75001": "48113", "90210": "06037" }
```

## Status

`zip-county.json` currently holds a **small fixture** (~11 ZIPs) so the whole pipeline is testable
and demoable. Everything downstream (the pure builder `src/modules/coverage/county.ts`, the
`/api/coverage` response, the portal territory, and the map component) is complete and does **not**
change when the real data lands — only this one file grows.

## Swapping in the full dataset (~41k ZIPs)

1. **Source (public domain, US government):**
   - **HUD USPS ZIP→COUNTY crosswalk** (quarterly XLSX) — has a `RES_RATIO` per ZIP×county row.
     Pick, per ZIP, the county with the highest `RES_RATIO` (a ZIP can span counties; we color by
     its dominant/primary county). This is the recommended source.
   - Alternatively the Census ZCTA→county relationship file (note ZCTA ≠ ZIP exactly).
2. **Shape it** to a flat `{ zip5: countyFips }` object — one primary county per ZIP — zero-padded
   to 5 digits on both sides (e.g. `"06037"`, not `6037`).
3. Replace `zip-county.json` with the result. No code change. `crosswalkSize()` in
   `../zip-county.ts` will report the new count.

The file is imported into the **server** bundle only (never shipped to the client), so a ~1 MB JSON
here is fine.

## Provenance & verification (2026-08-03)

Built from the US Census 2020 ZCTA→county relationship file (`tab20_zcta520_county20_natl.txt`,
pipe-delimited; ZCTA5 = col 2, county FIPS = col 10, ZCTA-in-county land area = col 17). Per ZCTA,
the county with the largest `AREALAND_PART` is kept as the primary county.

Cross-checks run against the generated file:
- **33,642 ZIPs → 3,124 counties**, all keys/values well-formed 5-digit, all 51 state prefixes
  (50 + DC) present.
- **14/14 residential ground-truth ZIPs** resolve to the correct county (Manhattan→New York,
  Beverly Hills→LA, Seattle→King, Anchorage→Anchorage, …).
- **Every FIPS exists in the map geometry** (`public/geo/us-counties.json`) — 0 orphans after the
  Alaska recode below.
- **Primary-county pick is decisive:** of the 30% of ZIPs that span >1 county, 96.5% have a clear
  land majority (>50%) in the chosen county; only ~1% of all ZIPs are genuine near-ties.

Known limitations (inherent to ZCTA data, acceptable for coloring):
- **PO-box-only ZIPs have no ZCTA** (e.g. 20500) and are absent — such a ZIP falls back to
  state-level coloring, never a county.
- **Land-area, not population**, decides the primary county for the ~1% of near-tie multi-county
  ZIPs (HUD's crosswalk uses residential ratio; it needs an API token). Negligible for coloring.
- **2019 Alaska recode:** Valdez-Cordova (02261) was split into Chugach (02063) + Copper River
  (02066). The 2020 data uses the new codes but the county geometry still carries 02261, so those
  8 ZIPs are aliased back to `02261` (same footprint). Re-apply this alias on any regenerate.
