# PSOS v3 — money-anchored

Replaces the PSOS v2.1 app at `mo-r-s.github.io/PSOS/`.

## What changed
Money is no longer a module. It is the spine. Every project is traced to the
sources that fund it and the outflows it drives, and its status is derived from
that trace rather than declared.

## Deploy
Upload these to the root of the `PSOS` repo, replacing what is there:

    index.html
    app.js            <- new file, must be uploaded
    sw.js
    manifest.webmanifest
    icons/            <- all six PNGs

Then on your phone: close PSOS fully, reopen, pull to refresh. The service
worker is `psos-cache-v7`, so it will discard the v6 cache on its own.

## Your v2.1 data
This version uses a new storage key (`psos3.state`), so nothing from v2.1 is
touched or lost. It sits alongside. If you want the old ledger, export it from
v2.1 before overwriting, then re-enter what matters — the shapes differ too much
for a clean automatic migration.

## Workbook features now in the app
Category summaries (income and spend), net position in USD, annualised figures,
next-due dates and paid/pending status on outflows, dates on income receipts,
USD-denominated income, the five largest outflows ranked, an income donut chart,
and editable category lists under Settings.

Share target now works: share a bank or mobile-money SMS to PSOS and it opens the
movement form with the amount and text already filled in.

## Seeded from
July_2026.xlsx — your own figures, not the earlier placeholder.

  Income   UGX 48,300,000  (salary 2,300,000 + allowances 46,000,000)
  Outflow  UGX 37,799,350  (rent counted quarterly, per your Commitments sheet)
  Net      UGX 10,500,650
  Run rate UGX (2,507,000) a month once the one-offs clear

Period is 1 month. Rate 3,707 (investing.com, 17 July 2026).
Reserves carry your vehicle balance of 10,000,000 against an 18,000,000 target,
and the 2031 campaign target of 1,000,000,000.

The eight obligations (Kats, Martin, Ike, Jessica, Luke, Gilbert, Rajiv and the
car deposit) are tagged as Debt Repayment and routed through a "Debt clearance"
project funded by the allowance. Nothing in the ledger is now untagged or
unassigned.

  Debt being retired   UGX 26,500,000
  Actual cost of living UGX 11,299,350  (of which 4,807,000 recurring)

Debt register under Money -> Debts. The eight obligations are seeded with their
monthly instalments and a 15%-per-month late penalty. Balances are blank: enter
them and the app prices delay and projects a free-and-clear date.

State version is now 4, so this replaces the earlier seed on first open.
