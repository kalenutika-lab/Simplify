// Record shapes, defaults and factories. Projects are plain data, never hard-coded in logic.

export const PRIORITIES = ['high', 'medium', 'low'];
export const MANUAL = ['pin', 'normal', 'later'];
export const SCHEMA_VERSION = 1;

export function newId(prefix) {
  const c = globalThis.crypto;
  const rnd = c && c.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${rnd}`;
}

export function nowISO(now = new Date()) {
  return now.toISOString();
}

export const DEFAULT_WEIGHTS = Object.freeze({
  overdueBase: 100,
  overduePerDay: 2,
  overdueMaxExtra: 20,
  today: 80,
  tomorrow: 60,
  days2to3: 45,
  days4to7: 30,
  days8to14: 18,
  days15to30: 10,
  days31plus: 5,
  noDeadline: 8,
  high: 30,
  medium: 15,
  low: 0,
  mandatory: 15,
  blockerPer: 5,
  blockerMax: 15,
  manual: 1000,
});

/** Preferences shared between devices through sync. */
export function defaultPrefs() {
  return {
    id: 'prefs',
    defaultPriority: 'medium',
    weekStart: 1,
    focusWeekday: 240,
    focusWeekend: 120,
    weights: { ...DEFAULT_WEIGHTS },
    defaultReminderMinutes: null,
    updatedAt: '1970-01-01T00:00:00.000Z',
  };
}

/** Settings that stay on this device only. */
export function defaultDevice(lang) {
  return {
    lang: lang === 'fr' ? 'fr' : 'en',
    theme: 'system',
    notifications: false,
    sync: { enabled: false, token: '', passphrase: '', gistId: '', lastSync: null, lastError: null },
  };
}

const SEED = [
  { key: 'case', en: 'Case Study', fr: 'Étude de cas', mandatory: true, boost: 10, priority: 'high', color: '#0891b2' },
  { key: 'apps', en: 'Applications / Candidatures', fr: 'Candidatures / Applications', mandatory: true, boost: 10, priority: 'high', color: '#9333ea' },
  { key: 'ai', en: 'AI Startup', fr: 'Startup IA', mandatory: false, boost: 0, priority: 'medium', color: '#16a34a' },
  { key: 'linkedin', en: 'LinkedIn Networking / Connections', fr: 'Réseau LinkedIn / Connexions', mandatory: false, boost: 0, priority: 'medium', color: '#2563eb' },
  { key: 'skema', en: 'SKEMA Assignments', fr: 'Devoirs SKEMA', mandatory: false, boost: 0, priority: 'medium', color: '#db2777' },
  { key: 'mck', en: 'McKinsey Forward Program', fr: 'Programme McKinsey Forward', mandatory: false, boost: 0, priority: 'medium', color: '#e11d48' },
];

export function seedProjects(lang = 'en', now = new Date()) {
  const ts = nowISO(now);
  return SEED.map((s, i) => ({
    id: `proj_default_${s.key}`,
    name: lang === 'fr' ? s.fr : s.en,
    description: '',
    objective: '',
    priority: s.priority,
    mandatory: s.mandatory,
    boost: s.boost,
    color: s.color,
    targetDate: null,
    notes: '',
    links: [],
    order: i,
    archived: false,
    deleted: false,
    createdAt: ts,
    updatedAt: ts,
  }));
}

export function makeProject(fields = {}, now = new Date()) {
  const ts = nowISO(now);
  return {
    id: newId('proj'),
    name: '',
    description: '',
    objective: '',
    priority: 'medium',
    mandatory: false,
    boost: 0,
    color: '#5b6b7a',
    targetDate: null,
    notes: '',
    links: [],
    order: 0,
    archived: false,
    deleted: false,
    createdAt: ts,
    updatedAt: ts,
    ...fields,
  };
}

export function makeTask(fields = {}, now = new Date()) {
  const ts = nowISO(now);
  return {
    id: newId('task'),
    title: '',
    description: '',
    projectId: null,
    dueDate: null,
    dueTime: null,
    priority: 'medium',
    mandatory: false,
    estimateMin: null,
    reminders: [],
    checklist: [],
    blockedBy: [],
    notes: '',
    links: [],
    done: false,
    completedAt: null,
    manual: 'normal',
    postponeCount: 0,
    deleted: false,
    createdAt: ts,
    updatedAt: ts,
    ...fields,
  };
}

export function makeReminder(fields = {}) {
  return { id: newId('rem'), kind: 'before', minutes: 60, at: null, enabled: true, snoozedUntil: null, firedFor: null, ...fields };
}

export const isLive = (r) => r && !r.deleted;
