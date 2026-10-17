# Personal Project Manager: product specification

Version 1, 17/10/2026. Owner: hi. Status: agreed answers from Phase A.

## Who and where
- Android phone (Chrome) and a computer (any modern browser).
- English and French, switchable at any time in Settings.
- Week starts Monday. Dates shown as 17/10/2026, times in 24-hour format, always in the device's local time zone.

## What the app is
An installable web app (PWA). It works offline, stores everything on the device (IndexedDB) and needs no server. It has five tabs: Home, Projects, Agenda, Progress, Settings.

## Data
- **Task:** title (only required field), description, project, deadline date, optional deadline time, priority (high / medium / low), mandatory flag, estimated minutes, reminders, checklist (subtasks), "blocked by" other tasks, notes, links, done/completed date, manual override (pin to top / normal / push down), times postponed, created and updated timestamps, stable ID.
- **Project:** name, description, objective, priority, optional target date, notes, links, order, archived flag, priority boost. The six projects are created as editable data: Case Study and Applications / Candidatures (mandatory, +10 boost), AI Startup, LinkedIn Networking / Connections, SKEMA Assignments, McKinsey Forward Program (neutral).
- Deadlines are stored as a plain local date and time ("2026-10-18 18:00"), so daylight-saving changes never move them. Timestamps are stored in UTC.
- Deleted items keep a small "deleted" marker so sync can remove them from the other device.

## Priority score (deterministic, shown on every task)
Score = deadline urgency + importance + mandatory + project boost + blocking bonus + manual override. Defaults, all editable in Settings:

| Factor | Points |
|---|---|
| Overdue | 100, plus 2 per day late (max +20) |
| Due today / tomorrow | 80 / 60 |
| Due in 2-3 / 4-7 / 8-14 / 15-30 / 31+ days | 45 / 30 / 18 / 10 / 5 |
| No deadline | 8 |
| Priority high / medium / low | 30 / 15 / 0 |
| Mandatory task | +15 |
| Project boost | Case Study and Applications +10, others 0 |
| Blocks other open tasks | +5 per task, max +15 |
| Pinned / pushed down | +1000 / -1000 |

Ties are broken by earlier deadline, then oldest task. Every task shows the factors behind its score in plain words. The app never changes a deadline by itself, and a postponement only counts when you move a deadline later.

## Home screen
Today's date, the top 3 tasks, overdue, due today, next deadlines (7 days), quick-add, "fits in your day" (adds up estimated time of the top tasks against today's focus time: 4h weekdays, 2h weekends; tasks without an estimate are listed as not counted, and nothing is put in your calendar automatically), then the full ranked list with filters: Today, Overdue, Upcoming, All, No deadline, Completed.

Quick-add understands simple English and French, such as "Finish the market-sizing case tomorrow by 18:00, high priority, 90 minutes" or "Relancer Paul demain 9h urgent". It shows what it understood before saving, and asks when a date is unclear.

## Other tabs
- **Projects:** create, edit, reorder, archive, restore. Progress bar, done / remaining counts, notes and links.
- **Agenda:** day and week views, overdue list, upcoming deadlines, reschedule (with a confirmation), tap a task to open it.
- **Progress:** done today and this week, outstanding, overdue, upcoming, completion by project, projects with no progress in 7 days, tasks postponed 2 or more times. Every number is counted from stored data.
- **Settings:** language, theme, default priority, week start, focus hours, score weights, reminders, sync, export, import / restore, delete all data, plain-language limitations.

## Reminders
- Each task can have reminders "X minutes/hours/days before the deadline" (these move automatically when the deadline moves) or at a fixed date and time. You can snooze or delete them, and they are cancelled when the task is done or deleted.
- While the app is open (or reopened), due reminders show as a banner and as an Android notification if you allow it. Each reminder fires once.
- **Limitation:** a web app cannot wake your phone at a set time without a push server. The Chrome feature that would have allowed this (Notification Triggers) was abandoned by Google. For alerts while the app is closed, each task has "Add to Google Calendar" and "Download calendar file (.ics)", so your phone's calendar does the alerting.

## Sync between phone and computer
- **Recommended free option:** a secret GitHub Gist under your own GitHub account, which is free. The app encrypts your data with a passphrase only you know before it uploads, so GitHub only ever stores unreadable data. You create one GitHub access token limited to Gists, then paste the token and passphrase on each device.
- The app syncs on open, after changes (when online) and on "Sync now". When the same task was edited on both devices, the most recent edit wins. Each sync is checked against the copy it started from, so nothing is silently overwritten.
- **Rejected:** Google Drive needs a Google Cloud project and an OAuth app, which is too much setup. Free database tiers need a third-party account and can expire or change terms.

## Backup
Export to a JSON file at any time. Import either merges (duplicates are skipped and newer versions win) or replaces everything (needs typed confirmation). The app reports what it imported, what it skipped and why.

## Costs (checked 17/10/2026)
- Running locally: free.
- Installing on Android: free (Chrome "Add to Home screen").
- Hosting: free on GitHub Pages for public repositories with GitHub Free. The code is public, your tasks are not. Limits are 1 GB per site and about 100 GB a month of traffic, far above what this app needs. Source: docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Sync: free (GitHub Gists come with the free account).
- Notifications when closed: free, through your own calendar app.

## Technical choices
Plain HTML, CSS and JavaScript with no build step, plus one vendored 13 KB UI library (htm + Preact, open source). There are no runtime downloads, analytics or trackers. Logic is tested with Node's built-in test runner and the full app with Playwright in Chromium.
