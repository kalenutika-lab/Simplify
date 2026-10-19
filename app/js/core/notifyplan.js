// Which reminders to hand to the phone's alarm system in the Android app. Pure logic so it
// can be tested: the soonest upcoming reminders, each with a stable numeric id.
import { reminderTime } from './reminders.js';
import { toLocalISO } from './dates.js';

export const MAX_SCHEDULED = 60;

/** 31-bit positive hash, stable across runs (Android notification ids are 32-bit ints). */
export function notificationId(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) || 1;
}

export function planNotifications(tasks, now = new Date(), max = MAX_SCHEDULED) {
  const out = [];
  for (const task of tasks) {
    if (!task || task.deleted || task.done) continue;
    for (const r of task.reminders || []) {
      if (!r.enabled) continue;
      const at = reminderTime(task, r);
      if (!at || at <= now) continue;
      const key = toLocalISO(at);
      if (r.firedFor === key) continue;
      out.push({ id: notificationId(`${task.id}|${r.id}|${key}`), at, taskId: task.id, title: task.title, dueDate: task.dueDate, dueTime: task.dueTime });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.id - b.id).slice(0, max);
}
