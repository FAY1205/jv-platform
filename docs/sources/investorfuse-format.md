# Source format: InvestorFuse opportunity export

Captured from two real weekly exports (2026-07-07): **61 columns, ~50 rows each**.
Header names only — the real files hold seller PII and are never committed.

## Canonical field mapping (ING-03) — the InvestorFuse Source Profile v1

| Canonical field | InvestorFuse column |
|-----------------|---------------------|
| campaign | `Campaign` |
| dateCreated | `Date Created` |
| notes | `Notes` **or** `Comments` — **OPEN: confirm which holds the MLS/"is it listed" text** (see below) |
| address | `Street Address` |
| city | `City` |
| state | `State` |
| zip | `Zip Code` (property ZIP — the territory key; NOT `Seller Zip Code`) |
| sellerFirst | `Seller First Name` |
| sellerLast | `Seller Last Name` |
| phone | `Seller Phone` |
| email | `Seller Email` |
| reasonForSelling | `Reason For Selling` |
| motivation | `Motivation` |
| timeToSell | `Time To Sell` |

`requiredColumns`: `address`, `zip`. `strictness`: flexible (many extra columns).
All other 47 columns (property details, CRM dates, pipeline/status/dead reasons) → preserved in `raw_json` (DM-02).

## OPEN QUESTION (resolve first in Phase 1)
The export has BOTH `Notes` (col 39) and `Comments` (col 40). The MLS filter (MLS-01..05)
reads the `notes` canonical field for the "is it listed?" signal. Inspect the real cell
contents locally to determine which column carries that text — or whether both should be
concatenated into `notes`. This is load-bearing for MLS accuracy; confirm with the owner.

## Full header list (order as exported)
1 Campaign · 2 Additional Campaigns · 3 Id · 4 Street Address · 5 City · 6 State · 7 Zip Code ·
8 Owner · 9 Seller Id · 10 Seller First Name · 11 Seller Last Name · 12 Seller Email ·
13 Seller Phone · 14 Seller Street Address · 15 Seller City · 16 Seller State · 17 Seller Zip Code ·
18 Property Type · 19 Bedrooms · 20 Bathrooms · 21 Size (SQFT) · 22 Lot Size · 23 Basement ·
24 Year Built · 25 Repairs · 26 Link to Files · 27 Subdivision · 28 Asking Price · 29 Listed Price ·
30 Market Value · 31 Mortgage · 32 Monthly Payment · 33 Taxes · 34 Renting For · 35 Going Rental Rate ·
36 Reason For Selling · 37 Motivation · 38 Time To Sell · 39 Notes · 40 Comments · 41 Pipeline ·
42 Sub-Pipeline · 43 Status · 44 Group · 45 Touches · 46 Contacted Type · 47 Dead Type ·
48 Dead Reason · 49 Secondary Owner · 50 Resurfaced Count · 51 Date of Last Touch · 52 Date Created ·
53 Date Qualified · 54 Date of 1st Appointment · 55 Date of 1st Offer · 56 Contract Date ·
57 Date of Going Under Contract · 58 Date Cancelled · 59 Date Closed · 60 Resurfaced Date · 61 Dead Date

## Real sample files (local only — PII, git-ignored)
`C:\Users\User\Downloads\investorfuse-opportunity-export (27).xlsx` and `(26).xlsx`.
Drop copies into the git-ignored `.samples/` dir in the repo for convenient local access.
