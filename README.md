# My Projects: personal project manager

A mobile-first app that answers six questions every day: what your three most important tasks are, what is overdue or due soon, what to do next, which projects are falling behind, how much work is left, and what fits in today.

It is an installable web app (PWA). It works offline and keeps your data on your own device, with optional encrypted sync between your phone and computer. It costs nothing to run.

- Product spec: [SPEC.md](SPEC.md)
- Test results and feature checklist: [TESTING.md](TESTING.md)

---

## 1. Use it on your computer (no installation needed)

You need [Node.js](https://nodejs.org) (the free LTS version). In a terminal, inside this folder:

```
npm start
```

Then open **http://localhost:8080** in Chrome, Edge or Firefox. Press `Ctrl+C` in the terminal to stop the app.

There's nothing to install with npm, because the app has no dependencies. Your data stays in the browser even after you stop the app.

## 2. The online version (free, GitHub Pages)

The app is published from this repository at **https://kalenutika-lab.github.io/Simplify/**. The **code** is public, but your **tasks never are**: they stay on your devices, and anything synced is encrypted.

Each time a change is pushed to `main`, GitHub Actions runs the logic tests and then publishes the `app/` folder (see `.github/workflows/pages.yml`). If the tests fail, nothing is published.

If the site ever shows "404", check that **Settings > Pages > Build and deployment > Source** is set to **GitHub Actions**.

**When you change app files:** increase the `VERSION` in `app/sw.js` (for example `ppm-v1.0.1`) so phones fetch the new version. The app then shows "A new version is ready, Reload".

## 3. Install it on your Android phone

1. Open **https://kalenutika-lab.github.io/Simplify/** in **Chrome**.
2. Tap the **⋮** menu, then **Install app** (or **Add to Home screen**).
3. The app now opens from its own icon, full screen, and works without internet.

On a computer, Chrome and Edge show an install icon in the address bar. You can also use the app in a normal tab.

## 4. Sync between phone and computer (optional, free)

Sync uses a **secret GitHub Gist** on your own account. Before anything leaves your device, the app encrypts it with a passphrase only you know (AES-256). GitHub only ever stores unreadable data.

**On your computer (once):**
1. In the app, open **Settings > Sync between devices > First device** and tap **Create my GitHub key**. GitHub opens a "new token" page already filled in with a name and only the **gist** permission.
2. Choose an expiration (for example 1 year), scroll down and press **Generate token**. Copy the code that starts with `ghp_`.
3. Back in the app, paste it, choose a passphrase (8 characters or more) and tap **Turn on sync**.
4. A QR code appears (later you can show it again with **Connect another device**).

**On your phone:**
5. Open the phone's camera, point it at the QR code and tap the link. The app opens at Settings.
6. Type the **same passphrase** and tap **Connect**. Your tasks appear.

The QR code holds your token locked with your passphrase, so it is useless to anyone who doesn't know the passphrase. You can also use **Copy link** and send the link to yourself instead of scanning.

The app syncs when it opens, a few seconds after each change, when you come back online, and whenever you tap **Sync now**. If the same task was edited on both devices, the latest edit wins. Deleted items are deleted on both devices.

Good to know:
- If you forget the passphrase, the synced copy can't be read. Each device still keeps its own data.
- When the token expires, sync shows "GitHub rejected the token". Create a new one and paste it in.
- If you type a wrong passphrase on a device, nothing gets overwritten.

## 5. Backups and restoring

- **Export:** go to Settings > Backup and restore > **Export backup**. You get a `.json` file. Do this every week and keep the file somewhere safe, such as Google Drive or an email to yourself.
- **Import:** choose a backup file. The app first shows a preview listing new, updated, identical and rejected records, with the reason for each rejection. Then press **Import now**.
  - **Merge** (recommended) never creates duplicates, and the newer version of each item wins.
  - **Replace** swaps everything on this device for the file. You must type REPLACE to confirm.
- A broken or foreign file changes nothing.

**Why backups matter:** without sync, your data exists only in this browser on this device. Clearing the browser's site data, uninstalling the browser or losing the phone deletes it.

## 6. How priority is calculated

Each open task gets points, and the highest total comes first. Tap the number on any task to see its points broken down.

| Factor | Points |
|---|---|
| Overdue | 100, plus 2 per day late (max +20) |
| Due today / tomorrow | 80 / 60 |
| Due in 2-3 / 4-7 / 8-14 / 15-30 / 31+ days | 45 / 30 / 18 / 10 / 5 |
| No deadline | 8 |
| Priority high / medium / low | 30 / 15 / 0 |
| Mandatory task | +15 |
| Project boost (Case Study, Applications) | +10 (other projects 0, editable per project) |
| Other open tasks are waiting on this one | +5 each, max +15 |
| Pinned / pushed down by you | +1000 / -1000 |

Ties go to the earlier deadline, then the older task. All numbers are editable in Settings > Priority scoring. The app never changes a deadline by itself: moving one always asks you first.

**"What fits today"** adds up the estimated time of your top-ranked tasks until today's focus time is used: 4 h on weekdays and 2 h at weekends, both editable. Tasks without an estimate are listed but not counted. Nothing is put in your calendar.

## 7. Reminders: what works and what doesn't

- Add reminders to a task: "X before the deadline" (these move with the deadline) or a fixed date and time.
- When the app is open, or the next time you open it, a due reminder shows as a banner with Open, Snooze 10 min, Snooze 1 h, Done and Dismiss. If you allow notifications, it also shows as an Android notification. Each reminder appears once, including across synced devices.
- **Limitation:** a web app can't wake your phone at a set time while it is closed, unless a paid or self-run push server is added. The browser feature that would have allowed this (Notification Triggers) was [abandoned by Google](https://developer.chrome.com/docs/web-platform/notification-triggers).
- **Free workaround:** any task with a deadline has **Add to Google Calendar** and **Download calendar file (.ics)**, so your phone's calendar alerts you even when the app is closed. Calendar entries don't update automatically if you move the deadline later.

## 8. Costs (checked 17 October 2026)

| Capability | Cost | Notes |
|---|---|---|
| Running locally | Free | Node.js is free and open source; the app has no dependencies |
| Installing on Android | Free | Chrome "Install app"; no Play Store account needed |
| Public hosting | Free | GitHub Pages works for public repositories on GitHub Free. Limits are 1 GB per site and about 100 GB of traffic a month ([source](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)) |
| Sync | Free | Secret Gists come with any GitHub account. API limit: 5,000 requests per hour per token |
| Alerts while the app is closed | Free | Through your own calendar app |
| AI | None used | Quick-add uses built-in rules |

No analytics, ads or trackers. The app only contacts the internet for sync (api.github.com) and only when you turn sync on. "Add to Google Calendar" opens Google with the task details, and only when you tap it.

## 9. Known limitations

- Reminders only fire while the app is open (see section 7).
- Quick-add understands common English and French phrases, not everything. Always check the preview it shows. It never guesses vague dates such as "next week".
- The calendar view is an agenda list with day and week views, not a month grid.
- Sync merges edits per task. If you edit the same task on two devices before they sync, the most recent edit wins and the other edit to that task is lost.
- Typed dates use DD/MM/YYYY. The "Calendar" button opens your browser's own date picker, which may display dates in the browser's language format.

## 10. For maintenance (technical)

```
app/            the whole app: what GitHub Pages serves
  index.html, manifest.webmanifest, sw.js (offline cache, bump VERSION on release)
  js/core/      pure logic, tested in Node: dates, scoring, parse (quick-add), reminders, stats,
                validate (import), merge + crypto + sync (GitHub Gist)
  js/ui/        screens (Preact + htm, no build step)
  js/store.js   state + IndexedDB persistence;  js/db.js IndexedDB wrapper
  js/vendor/    htm + Preact standalone (Apache-2.0 / MIT), vendored so no CDN is needed
tests/unit/     node --test (logic)
tests/e2e/      browser tests with Playwright + Chromium
tools/serve.js  tiny local web server
```

Commands:
- `npm start`: run locally on port 8080
- `npm test`: logic tests. Try `TZ=America/New_York npm test` as well
- `npm run test:e2e`: browser tests. Needs Playwright: `npm install --no-save playwright && npx playwright install chromium`

Data format: tasks and projects are plain JSON records with stable IDs and `createdAt`/`updatedAt` timestamps in UTC. Deadlines are stored as a local calendar date (`2026-10-18`) plus an optional local time (`18:00`), so daylight-saving changes never move them.
