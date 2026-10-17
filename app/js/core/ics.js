// Calendar export so the phone's own calendar can alert when the app is closed.
import { addDays, localDate } from './dates.js';
import { DATE_ONLY_BASE } from './reminders.js';

const compact = (ymd) => ymd.replace(/-/g, '');
const compactDT = (ymd, hm) => `${compact(ymd)}T${hm.replace(':', '')}00`;

function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function fold(line) {
  const parts = [];
  let s = line;
  while (s.length > 74) { parts.push(s.slice(0, 74)); s = ' ' + s.slice(74); }
  parts.push(s);
  return parts.join('\r\n');
}

function endTime(task) {
  const start = localDate(task.dueDate, task.dueTime);
  const end = new Date(start.getTime() + 30 * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return { ymd: `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}`, hm: `${p(end.getHours())}:${p(end.getMinutes())}` };
}

function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** iCalendar text for one task with a deadline. Times are "floating" local times. */
export function buildICS(task, { projectName = '', now = new Date() } = {}) {
  if (!task.dueDate) return null;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Personal Project Manager//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT'];
  lines.push(`UID:${task.id}@personal-project-manager`);
  lines.push(`DTSTAMP:${utcStamp(now)}`);
  if (task.dueTime) {
    const e = endTime(task);
    lines.push(`DTSTART:${compactDT(task.dueDate, task.dueTime)}`);
    lines.push(`DTEND:${compactDT(e.ymd, e.hm)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compact(task.dueDate)}`);
    lines.push(`DTEND;VALUE=DATE:${compact(addDays(task.dueDate, 1))}`);
  }
  lines.push(`SUMMARY:${esc(task.title)}`);
  const desc = [projectName, task.description].filter(Boolean).join('\n');
  if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
  const alarms = (task.reminders || []).filter((r) => r.enabled && r.kind === 'before');
  for (const r of alarms) {
    // For all-day events the alarm is relative to midnight; shift by the 09:00 base.
    const offset = task.dueTime ? Number(r.minutes) : Number(r.minutes) - toMin(DATE_ONLY_BASE);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(task.title)}`, `TRIGGER:${offset >= 0 ? '-' : ''}PT${Math.abs(offset)}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

/** Pre-filled "create event" link for Google Calendar. Opens Google; nothing is sent until the user saves there. */
export function googleCalendarUrl(task, { projectName = '' } = {}) {
  if (!task.dueDate) return null;
  let dates;
  if (task.dueTime) {
    const e = endTime(task);
    dates = `${compactDT(task.dueDate, task.dueTime)}/${compactDT(e.ymd, e.hm)}`;
  } else {
    dates = `${compact(task.dueDate)}/${compact(addDays(task.dueDate, 1))}`;
  }
  const details = [projectName, task.description].filter(Boolean).join('\n');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: task.title, dates });
  if (details) q.set('details', details);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
