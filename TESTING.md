# Testing report and feature checklist

Last run: 18/10/2026, version 1.0.0.

- **Automated logic tests** (`npm test`): 33 tests, all passing. They were run under four time zones: Europe/Paris, America/New_York, Asia/Kolkata and UTC.
- **Automated browser tests** (`npm run test:e2e`): 11 scenarios in real Chromium (Playwright), all passing. They use a fixed clock and an isolated, fresh browser profile per scenario.
- **Manual or visual checks:** I reviewed screenshots at 360, 390, 768 and 1280 px wide.
- **Not tested here:** a physical Android phone, real GitHub sync (no account or token in the build environment) and real system notifications. Those parts are covered by simulated tests only, as noted below.

## Required tests (from the brief)

| # | Test | How | Result |
|---|---|---|---|
| 1 | Create a task with only a title | Browser | Pass |
| 2 | Edit and delete tasks (confirm, undo, unsaved-changes guard, duplicate) | Browser | Pass |
| 3 | Complete and reopen | Browser | Pass |
| 4 | Overdue / today / upcoming ordering | Logic + browser | Pass |
| 5 | Mandatory weight and manual pin / push-down | Logic + browser | Pass |
| 6 | Tasks without deadlines (default rank, filter) | Logic + browser | Pass |
| 7 | Reminder creation, rescheduling, show once, snooze, dismiss | Logic + browser (fixed clock) | Pass |
| 8 | Data survives reload | Browser | Pass |
| 9 | Export and restore (delete all, then import) | Browser | Pass |
| 10 | Invalid, duplicate and corrupted imports | Logic + browser | Pass. Each rejected record is listed with its reason |
| 11 | Empty states | Browser | Pass |
| 12 | Phone and desktop layouts (no sideways scrolling, 44 px touch targets) | Browser at 360, 390, 768 and 1280 px | Pass |
| 13 | Offline use after the first visit (load and add a task) | Browser, network switched off | Pass |
| 14 | Time zones and midnight boundary; daylight-saving change (25/10 Europe, 01/11 US) | Logic in 4 zones + browser in New York | Pass |

Extra checks:
- Quick-add parsing in English and French, with ambiguous dates offered as choices: logic and browser tests, pass.
- Sync merging, deletions reaching other devices, two devices converging, encryption, a wrong passphrase never overwriting data, a bad token, offline: logic tests against a **simulated** GitHub API, pass.
- Switching language to French and back after a reload: browser test, pass.
- Progress figures and project completion counts: logic and browser tests, pass.
- Archiving and restoring a project: browser test, pass.
- Every on-screen text exists in both English and French: automated check, pass.
- The offline cache lists every app file: automated check, pass.

## Defects found during testing and fixed

1. Reopening the app could stay stuck on "Loading…" when storage loaded very fast. The screen missed the "ready" signal. Fixed, and the reload tests now cover it.
2. The first visit reloaded the page once while the offline cache was being installed, which could lose a task typed in that first second. Fixed.
3. "1 day before" reminders would have shifted by an hour across a daylight-saving change. They now keep the same clock time. Fixed and covered by a test.
4. Snoozing a reminder left the banner visible until the save finished. It now closes immediately.
5. Brand-new projects were wrongly flagged as "needing attention". Now a project is only flagged once it has had open tasks for 7 days with none completed.

## Feature checklist

| Feature | Status |
|---|---|
| Five tabs: Home, Projects, Agenda, Progress, Settings | Done |
| Home: date, top 3, overdue, due today, next 7 days, quick-add, what fits today, projects needing attention, full ranked list with 6 filters, sort, project filter, search | Done |
| Every task field from the brief (ID, title, description, project, date, optional time, priority, mandatory, estimate, reminders, checklist, notes, links, status, timestamps, plus dependencies and manual override) | Done |
| Create, edit, complete and reopen, delete with confirm and undo, duplicate, reschedule, reminders, filter and sort, subtasks, move between projects | Done |
| Deterministic, explained, configurable scoring; never changes deadlines by itself | Done |
| Six default projects stored as data; create, edit, reorder, archive, restore, delete | Done |
| Agenda: day and week views, overdue, reschedule with confirmation, upcoming reminders | Done |
| Progress: done today and this week, open, overdue, due in 7 days, by project, stale projects, postponed tasks | Done |
| Settings: language (EN/FR), theme, default priority, week start, focus time, weights, reminders, sync, export, import, delete, limitations | Done |
| Offline, installable (manifest + service worker), update prompt | Done |
| Encrypted sync through a GitHub Gist | Done, tested against a simulated API only |
| Notifications while the app is open, plus Google Calendar and .ics export | Done; Android system notifications not tested on a real phone |

## Remaining known issues

- No critical defects are known in the tested workflows.
- Real-device checks are still to do on your Android phone: installing the app, notification permission, and the Google Calendar button.
- Real GitHub sync still needs to be checked once with your token.
