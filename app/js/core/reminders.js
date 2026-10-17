// Reminder timing. A "before" reminder is stored relative to the deadline, so it
// moves automatically when the deadline is rescheduled. An "at" reminder is a fixed
// local date-time. Each reminder fires once per computed time (firedFor = that time).
import { localDate, toLocalISO, fromLocalISO, addDays } from './dates.js';

/** When a task has a date but no time, "before" reminders count back from 09:00 on that day. */
export const DATE_ONLY_BASE = '09:00';

export function baseTime(task, r) {
  if (r.kind === 'at') return fromLocalISO(r.at);
  if (!task.dueDate) return null;
  // Whole days are counted on the calendar (same wall-clock time), so "1 day before"
  // stays at the same hour across a daylight-saving change; the remainder in minutes.
  const m = Math.max(0, Number(r.minutes) || 0);
  const days = Math.floor(m / 1440);
  const due = localDate(addDays(task.dueDate, -days), task.dueTime || DATE_ONLY_BASE);
  return new Date(due.getTime() - (m % 1440) * 60000);
}

/** Effective trigger time, taking a snooze into account. */
export function reminderTime(task, r) {
  const base = baseTime(task, r);
  if (!base) return null;
  const snooze = r.snoozedUntil ? fromLocalISO(r.snoozedUntil) : null;
  return snooze && snooze > base ? snooze : base;
}

export function reminderKey(task, r) {
  const t = reminderTime(task, r);
  return t ? toLocalISO(t) : null;
}

const active = (t) => t && !t.deleted && !t.done;

/** Reminders whose time has come and that have not been shown for that time yet. */
export function dueReminders(tasks, now = new Date()) {
  const out = [];
  for (const task of tasks) {
    if (!active(task)) continue;
    for (const r of task.reminders || []) {
      if (!r.enabled) continue;
      const time = reminderTime(task, r);
      if (!time || time > now) continue;
      const key = toLocalISO(time);
      if (r.firedFor === key) continue;
      out.push({ task, reminder: r, time, key });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Upcoming reminders within `days` days, for the in-app list. */
export function upcomingReminders(tasks, now = new Date(), days = 7) {
  const limit = new Date(now.getTime() + days * 86400000);
  const out = [];
  for (const task of tasks) {
    if (!active(task)) continue;
    for (const r of task.reminders || []) {
      if (!r.enabled) continue;
      const time = reminderTime(task, r);
      if (!time || time <= now || time > limit) continue;
      out.push({ task, reminder: r, time });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Reminders that can never fire (a "before" reminder on a task with no deadline). */
export function isInactive(task, r) {
  return r.kind === 'before' && !task.dueDate;
}

export function snoozeUntil(now, minutes) {
  return toLocalISO(new Date(now.getTime() + minutes * 60000));
}
