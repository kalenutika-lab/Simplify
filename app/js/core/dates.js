// Date helpers. Deadlines are stored as plain local calendar dates ("YYYY-MM-DD")
// and optional local times ("HH:MM"), so daylight-saving changes never shift them.
// Day arithmetic is done in UTC on those calendar dates, which has no DST gaps.

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

export function isValidYMD(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1970 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function isValidHM(s) {
  if (typeof s !== 'string' || !/^\d{2}:\d{2}$/.test(s)) return false;
  const [h, m] = s.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function ymd(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Local calendar date of a JS Date. */
export function toYMD(date) {
  return ymd(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function toHM(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function todayYMD(now = new Date()) {
  return toYMD(now);
}

function utcOf(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(s, n) {
  const t = new Date(utcOf(s) + n * DAY);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole calendar days from a to b (b - a). */
export function diffDays(a, b) {
  return Math.round((utcOf(b) - utcOf(a)) / DAY);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(s) {
  return new Date(utcOf(s)).getUTCDay();
}

export function startOfWeek(s, weekStart = 1) {
  const back = (weekday(s) - weekStart + 7) % 7;
  return addDays(s, -back);
}

export function isWeekend(s) {
  const w = weekday(s);
  return w === 0 || w === 6;
}

/**
 * Local JS Date for a calendar date and wall-clock time. If the time does not
 * exist on that day (spring-forward gap), JS moves it forward, which is the
 * sensible reading of "at 02:30" on such a day.
 */
export function localDate(s, hm = '00:00') {
  const [y, m, d] = s.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi, 0, 0);
}

/** "2026-10-17T18:00" local wall-clock string <-> Date */
export function toLocalISO(date) {
  return `${toYMD(date)}T${toHM(date)}`;
}
export function fromLocalISO(s) {
  if (typeof s !== 'string') return null;
  const [d, t] = s.split('T');
  if (!isValidYMD(d) || !isValidHM(t)) return null;
  return localDate(d, t);
}

/** Display "17/10/2026" */
export function formatDMY(s) {
  if (!isValidYMD(s)) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

/** Parse "17/10/2026", "17/10/26", "17-10-2026", "17.10.2026" or ISO into YMD; null when invalid. */
export function parseDMY(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (isValidYMD(s)) return s;
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const out = ymd(y, Number(m[2]), Number(m[1]));
  return isValidYMD(out) ? out : null;
}

/** Parse "18:00", "18h", "18h30", "9:5" -> "HH:MM"; null when invalid. */
export function parseHM(input) {
  if (typeof input !== 'string') return null;
  const m = input.trim().toLowerCase().match(/^(\d{1,2})\s*(?:[:h.]\s*(\d{1,2})?)?$/);
  if (!m) return null;
  const out = `${pad(Number(m[1]))}:${pad(Number(m[2] || 0))}`;
  return isValidHM(out) ? out : null;
}

export function minutesLabel(min) {
  if (!min || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}
