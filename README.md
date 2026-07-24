# PSOS v3 — money-anchored

## No personal data in this repository
This app ships EMPTY. Every figure lives only in the browser storage on your own
device. Nothing about your income, debts, creditors or targets is in these files.

Do not paste financial data into index.html. If you want a seeded copy, keep it
as a local backup file and use Settings -> Restore backup.

## Verifying which build is live
Settings shows a Build stamp. It must read: v3.5 · 23 Jul 2026
Settings -> Test every screen runs a health check and reports any screen that
fails, so a blank screen never goes unexplained again.

IMPORTANT: index.html and app.js must be uploaded together. They are one version.

## Deploy
Upload to the repo root:

    index.html
    app.js            <- required; the app is blank without it
    sw.js
    manifest.webmanifest
    icons/

Cache is psos-cache-v12, so it retires the previous version by itself.

## First run
The app opens empty with a prompt to restore a backup. Load psos-my-data.json
(kept on your device, never uploaded) via Settings -> Restore backup.

## Backups
Settings -> Download backup writes a JSON file. Keep it somewhere private —
iCloud Drive, Google Drive, or your Mac. It contains everything.
