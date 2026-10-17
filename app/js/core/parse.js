// Rule-based quick-add parser (English and French). No AI, no network.
// It only proposes values; the app shows them for confirmation before saving.
// Ambiguous dates are returned as choices instead of being guessed.
import { addDays, todayYMD, weekday, ymd, isValidYMD, isValidHM, diffDays } from './dates.js';

const L = '(?<![\\p{L}\\d])';
const R = '(?![\\p{L}\\d])';
const rx = (src) => new RegExp(src, 'giu');

const WEEKDAYS = {
  // Full names only: short forms such as "sam", "mon" or "mar" are common words or names.
  sunday: 0, dimanche: 0,
  monday: 1, lundi: 1,
  tuesday: 2, mardi: 2,
  wednesday: 3, mercredi: 3,
  thursday: 4, jeudi: 4,
  friday: 5, vendredi: 5,
  saturday: 6, samedi: 6,
};
const MONTHS = {
  january: 1, jan: 1, janvier: 1, janv: 1,
  february: 2, feb: 2, février: 2, fevrier: 2, fév: 2, fev: 2, févr: 2,
  march: 3, mar: 3, mars: 3,
  april: 4, apr: 4, avril: 4, avr: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juin: 6,
  july: 7, jul: 7, juillet: 7, juil: 7,
  august: 8, aug: 8, août: 8, aout: 8,
  september: 9, sep: 9, sept: 9, septembre: 9,
  october: 10, oct: 10, octobre: 10,
  november: 11, nov: 11, novembre: 11,
  december: 12, dec: 12, décembre: 12, decembre: 12, déc: 12,
};
const WD = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
const MO = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const PRIO_WORDS = { high: 'high', haute: 'high', 'élevée': 'high', elevee: 'high', top: 'high', urgent: 'high', medium: 'medium', moyenne: 'medium', normal: 'medium', normale: 'medium', med: 'medium', low: 'low', basse: 'low', faible: 'low' };
const PW = Object.keys(PRIO_WORDS).join('|');
const DATE_LEAD = `(?:(?:on|by|due|for|before|le|pour|avant|d'ici|due\\s+by)\\s+)?`;
const TIME_LEAD = `(?:(?:at|by|before|à|avant|vers|@)\\s*)?`;

export function normalizeText(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function nextWeekday(today, wd, strict = true) {
  let d = (wd - weekday(today) + 7) % 7;
  if (d === 0 && strict) d = 7;
  return addDays(today, d);
}

/**
 * @param {string} text
 * @param {{ now?: Date, projects?: Array<{id:string,name:string,archived?:boolean,deleted?:boolean}> }} opts
 * @returns {{ title, dueDate, dueTime, priority, estimateMin, mandatory, projectId,
 *            recognized: Array<{kind, text, value}>, ambiguities: Array<{kind, text, options?, reason}> }}
 */
export function parseQuickAdd(text, opts = {}) {
  const now = opts.now || new Date();
  const today = todayYMD(now);
  const original = String(text || '').replace(/\s+/g, ' ').trim();
  // Keep a lowercase twin of the same length so match indexes line up.
  let work = original.toLowerCase();
  if (work.length !== original.length) work = original.replace(/./gu, (c) => (c.toLowerCase().length === c.length ? c.toLowerCase() : c));
  const removed = new Array(original.length).fill(false);
  const out = { title: '', dueDate: null, dueTime: null, priority: null, estimateMin: null, mandatory: false, projectId: null, recognized: [], ambiguities: [] };

  function take(re, fn) {
    re.lastIndex = 0;
    let m;
    const hits = [];
    while ((m = re.exec(work))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const start = m.index, end = m.index + m[0].length;
      if (removed.slice(start, end).some(Boolean)) continue;
      const keep = fn(m, original.slice(start, end).trim());
      if (keep !== false) hits.push([start, end]);
    }
    for (const [s, e] of hits) {
      for (let i = s; i < e; i++) removed[i] = true;
      work = work.slice(0, s) + ' '.repeat(e - s) + work.slice(e);
    }
  }

  // Project: "#case", "#skema"
  take(rx(`#([\\p{L}\\d_\\-]+)`), (m, raw) => {
    const tag = normalizeText(m[1]).replace(/[_-]/g, ' ');
    const list = (opts.projects || []).filter((p) => !p.deleted && !p.archived);
    const hit = list.find((p) => normalizeText(p.name).startsWith(tag)) || list.find((p) => normalizeText(p.name).includes(tag));
    if (hit) {
      out.projectId = hit.id;
      out.recognized.push({ kind: 'project', text: raw, value: hit.name });
    } else {
      out.ambiguities.push({ kind: 'project', text: raw, reason: 'unknownProject' });
    }
  });

  // Priority
  const setPrio = (word, raw) => {
    const v = PRIO_WORDS[word];
    if (!v) return false;
    if (out.priority && out.priority !== v) out.ambiguities.push({ kind: 'priority', text: raw, reason: 'conflict' });
    out.priority = v;
    out.recognized.push({ kind: 'priority', text: raw, value: v });
  };
  take(rx(`${L}(?:priority|priorité|priorite|prio)\\s*[:=]?\\s*(${PW})${R}`), (m, raw) => setPrio(m[1], raw));
  take(rx(`${L}(${PW})\\s+(?:priority|priorité|priorite|prio)${R}`), (m, raw) => setPrio(m[1], raw));
  take(rx(`${L}(?:priorité|priorite)\\s+(${PW})${R}`), (m, raw) => setPrio(m[1], raw));
  take(rx(`!(high|haute|med|medium|low|basse)${R}`), (m, raw) => setPrio(m[1], raw));
  take(rx(`${L}(urgent|urgente)${R}`), (m, raw) => setPrio('urgent', raw));
  take(rx(`(?<![!\\p{L}\\d])!!${R}`), (m, raw) => setPrio('high', raw));

  // Mandatory
  take(rx(`${L}(mandatory|obligatoire|must-do)${R}`), (m, raw) => {
    out.mandatory = true;
    out.recognized.push({ kind: 'mandatory', text: raw, value: true });
  });

  // Duration
  const setDur = (min, raw) => {
    if (!(min > 0 && min <= 24 * 60)) { out.ambiguities.push({ kind: 'duration', text: raw, reason: 'invalidDuration' }); return; }
    out.estimateMin = Math.round(min);
    out.recognized.push({ kind: 'duration', text: raw, value: out.estimateMin });
  };
  const num = (s) => Number(String(s).replace(',', '.'));
  take(rx(`${L}(?:(?:for|pendant|durée|duree|takes|environ|about|~)\\s*)?(\\d{1,2})\\s*h\\s*(\\d{1,2})\\s*(?:min|mn)${R}`), (m, raw) => setDur(num(m[1]) * 60 + num(m[2]), raw));
  take(rx(`${L}(?:(?:for|pendant|durée|duree|takes|environ|about|~)\\s*)?(\\d+(?:[.,]\\d+)?)\\s*(?:hours|hour|hrs|hr|heures|heure)(?:\\s*(?:and\\s*|et\\s*)?(\\d{1,2})\\s*(?:minutes|minute|mins|min|mn))?${R}`), (m, raw) => setDur(num(m[1]) * 60 + (m[2] ? num(m[2]) : 0), raw));
  take(rx(`${L}(?:(?:for|pendant|durée|duree|takes|environ|about|~)\\s*)?(\\d+)\\s*(?:minutes|minute|mins|min|mn)${R}`), (m, raw) => setDur(num(m[1]), raw));
  take(rx(`${L}(?:for|pendant|durée|duree|takes)\\s+(\\d{1,2})\\s*h(?:\\s*(\\d{2}))?${R}`), (m, raw) => setDur(num(m[1]) * 60 + (m[2] ? num(m[2]) : 0), raw));

  // Time
  const setTime = (h, mi, raw) => {
    const t = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    if (!isValidHM(t)) { out.ambiguities.push({ kind: 'time', text: raw, reason: 'invalidTime' }); return; }
    if (out.dueTime && out.dueTime !== t) { out.ambiguities.push({ kind: 'time', text: raw, reason: 'twoTimes' }); return; }
    out.dueTime = t;
    out.recognized.push({ kind: 'time', text: raw, value: t });
  };
  const ampm = (h, suffix) => {
    h = Number(h);
    if (!suffix) return h;
    if (h < 1 || h > 12) return 99;
    if (suffix === 'am') return h === 12 ? 0 : h;
    return h === 12 ? 12 : h + 12;
  };
  take(rx(`${L}${TIME_LEAD}(\\d{1,2}):(\\d{2})\\s*(am|pm)?${R}`), (m, raw) => setTime(ampm(m[1], m[3]), Number(m[2]), raw));
  take(rx(`${L}${TIME_LEAD}(\\d{1,2})\\s*(am|pm)${R}`), (m, raw) => setTime(ampm(m[1], m[2]), 0, raw));
  take(rx(`${L}${TIME_LEAD}(\\d{1,2})h(\\d{2})?${R}`), (m, raw) => setTime(Number(m[1]), Number(m[2] || 0), raw));
  take(rx(`${L}${TIME_LEAD}(noon|midi)${R}`), (m, raw) => setTime(12, 0, raw));

  // Dates
  const setDate = (d, raw, note) => {
    if (!isValidYMD(d)) { out.ambiguities.push({ kind: 'date', text: raw, reason: 'invalidDate' }); return; }
    if (out.dueDate && out.dueDate !== d) { out.ambiguities.push({ kind: 'date', text: raw, reason: 'twoDates', options: [out.dueDate, d] }); return; }
    out.dueDate = d;
    out.recognized.push({ kind: 'date', text: raw, value: d, note });
  };
  const ask = (raw, options, reason) => out.ambiguities.push({ kind: 'date', text: raw, reason, options });

  take(rx(`${L}${DATE_LEAD}(?:day after tomorrow|après-demain|apres-demain|après demain|apres demain)${R}`), (m, raw) => setDate(addDays(today, 2), raw));
  take(rx(`${L}${DATE_LEAD}(?:today|tonight|this evening|aujourd'hui|aujourdhui|auj|ce soir|this afternoon|cet après-midi|cet apres-midi)${R}`), (m, raw) => setDate(today, raw));
  take(rx(`${L}${DATE_LEAD}(?:tomorrow|tmrw|demain)${R}`), (m, raw) => setDate(addDays(today, 1), raw));
  take(rx(`${L}(?:in|dans)\\s+(\\d{1,3})\\s+(days?|jours?|weeks?|semaines?)${R}`), (m, raw) => {
    const n = Number(m[1]) * (/^(w|s)/.test(m[2]) ? 7 : 1);
    setDate(addDays(today, n), raw);
  });
  take(rx(`${L}${DATE_LEAD}(?:next week|la semaine prochaine|semaine prochaine|next month|le mois prochain|mois prochain|this weekend|ce week-end|ce weekend|end of (?:the )?week|fin de (?:la )?semaine)${R}`), (m, raw) => {
    const k = normalizeText(raw);
    const mon = nextWeekday(today, 1, true);
    if (/month|mois/.test(k)) {
      const [y, mo] = today.split('-').map(Number);
      const first = mo === 12 ? ymd(y + 1, 1, 1) : ymd(y, mo + 1, 1);
      ask(raw, [first, addDays(first, 14)], 'vague');
    } else if (/weekend|week-end/.test(k)) {
      ask(raw, [nextWeekday(today, 6, false), nextWeekday(today, 0, false)], 'vague');
    } else if (/end of|fin de/.test(k)) {
      ask(raw, [nextWeekday(today, 5, false), nextWeekday(today, 0, false)], 'vague');
    } else {
      ask(raw, [mon, addDays(mon, 4)], 'vague');
    }
  });
  take(rx(`${L}${DATE_LEAD}(?:(next|this|ce|cette)\\s+)?(${WD})(?:\\s+(prochain|next))?${R}`), (m, raw) => {
    const wd = WEEKDAYS[m[2]];
    const isNext = /next|prochain/.test(`${m[1] || ''} ${m[3] || ''}`);
    if (!isNext && weekday(today) === wd) {
      ask(raw, [today, addDays(today, 7)], 'sameWeekday');
      return;
    }
    setDate(nextWeekday(today, wd, true), raw);
  });
  const withYear = (d, mo, y, raw) => {
    if (y) {
      y = Number(y);
      if (y < 100) y += 2000;
      return setDate(ymd(y, mo, d), raw);
    }
    const [ty] = today.split('-').map(Number);
    let cand = ymd(ty, mo, d);
    if (!isValidYMD(cand)) return setDate(cand, raw);
    if (diffDays(today, cand) < 0) {
      // Already passed this year: offer this year (overdue) or next year rather than guessing.
      const next = ymd(ty + 1, mo, d);
      ask(raw, [cand, next], 'pastDate');
      return;
    }
    setDate(cand, raw);
  };
  take(rx(`${L}${DATE_LEAD}(\\d{4})-(\\d{2})-(\\d{2})${R}`), (m, raw) => setDate(`${m[1]}-${m[2]}-${m[3]}`, raw));
  take(rx(`${L}${DATE_LEAD}(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{4}|\\d{2}))?${R}`), (m, raw) => withYear(Number(m[1]), Number(m[2]), m[3], raw));
  take(rx(`${L}${DATE_LEAD}(\\d{1,2})(?:st|nd|rd|th|er)?\\s+(${MO})\\.?(?:\\s+(\\d{4}))?${R}`), (m, raw) => withYear(Number(m[1]), MONTHS[m[2]], m[3], raw));
  take(rx(`${L}${DATE_LEAD}(${MO})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${R}`), (m, raw) => withYear(Number(m[2]), MONTHS[m[1]], m[3], raw));

  // A time with no date means today, but only if it has not passed; otherwise ask.
  if (out.dueTime && !out.dueDate && !out.ambiguities.some((a) => a.kind === 'date')) {
    const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (out.dueTime > nowHM) out.dueDate = today;
    else out.ambiguities.push({ kind: 'date', text: out.dueTime, reason: 'timeOnly', options: [today, addDays(today, 1)] });
  }

  let title = '';
  for (let i = 0; i < original.length; i++) title += removed[i] ? ' ' : original[i];
  title = cleanTitle(title);
  out.title = title || original;
  return out;
}

const TRAIL = /(?:^|\s)(?:by|at|on|due|for|before|and|with|à|le|pour|avant|et|de|du|d'ici|vers)\s*$/iu;
const LEAD = /^\s*(?:by|at|on|due|à|le|pour|avant)(?:\s+|$)/iu;

export function cleanTitle(s) {
  let t = s.replace(/\s+/g, ' ');
  for (let i = 0; i < 4; i++) {
    t = t.replace(/(\s*[,;:.\-–]\s*)+(?=[,;:.\-–]|\s*$)/g, '');
    t = t.replace(/\s+([,;:.])/g, '$1').replace(/([,;:])(?=\S)/g, '$1 ');
    t = t.trim().replace(/[,;:.\-–]+$/, '').trim();
    t = t.replace(TRAIL, '').trim();
    t = t.replace(LEAD, '').trim();
    t = t.replace(/^[,;:.\-–]+/, '').trim();
  }
  return t.replace(/\s{2,}/g, ' ');
}
