# PMS Dashboard — M.V. Seaways Mirage

A mobile-first Planned Maintenance System (PMS) web app / PWA for shipboard use.
Single self-contained web app (HTML + CSS + vanilla JS) — no build step, no server required to run locally.

## Files

| Path | Description |
|------|-------------|
| `index.html` | App shell + all styles |
| `app.js` | All application logic |
| `manifest.json`, `service-worker.js`, `icons/` | PWA (installable, offline) |

## Features

- **Dark-navy mobile-first UI** with a floating macOS-style bottom dock (Home / Daily / Monthly / Settings) and a collapsible chip bar (Search, Machines, Critical, Done, Postponed, Motor Starters, Weekly).
- **CSV auto-import** — drop in the raw PMS export from the ship's software; it's converted internally to the app's job format automatically. JSON/txt job lists also supported.
- **Per-occurrence job tracking** — completing a job records the done-date and advances its next-due cycle; the next cycle shows as a fresh pending job.
- **Swipe to complete / postpone** with a bottom-sheet completion dialog (location + scrollable date wheels).
- **Tap a card to flip** and see its last maintenance date.
- **PTW-06 permit system** — completing a Motor/Starter/Routine raises a permit; a flashing bell and collapsible list track pending permits, exportable to Excel (.xls).
- **Universal search** — multi-word (any field, any order) and precise date search.
- **Critical / Weekly / Monthly / Machines** views, estimated sign-off filtering, dark/light theme, and progress sync (export/import JSON) between devices.

## Running it

Open `index.html` directly in a browser for a quick look.

For full PWA behaviour (install to home screen, offline, hardware back button), serve this folder over HTTP, e.g.:

```bash
python -m http.server 8000
# then open http://localhost:8000 on your phone/desktop
```

Or enable **GitHub Pages** on this repo (Settings → Pages → deploy from `main` / root) to get a live URL.

Data and progress are stored in the browser's localStorage on each device.
