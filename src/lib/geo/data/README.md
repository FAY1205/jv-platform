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
