// App state, persistence and actions. Every change is written to IndexedDB right away.
import * as db from './db.js';
import { readPairCode } from './core/pair.js';
import { makeTask, makeProject, makeReminder, seedProjects, defaultPrefs, defaultDevice, nowISO, newId } from './core/model.js';
import { validateTask, validateProject, validatePrefs, planImport, buildExport } from './core/validate.js';
import { dueReminders, snoozeUntil } from './core/reminders.js';
import { mergeRecords } from './core/merge.js';
import { syncOnce } from './core/sync.js';

const listeners = new Set();

export const state = {
  ready: false,
  fatal: null,
  version: 0,
  tasks: [],
  projects: [],
  prefs: defaultPrefs(),
  device: defaultDevice('en'),
  alerts: [],
  toasts: [],
  sync: { running: false },
  pairCode: null,
  persisted: null,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  state.version++;
  for (const fn of listeners) fn(state.version);
}

export function toast(message, opts = {}) {
  const id = newId('toast');
  state.toasts = [...state.toasts.slice(-2), { id, message, kind: opts.kind || 'info', action: opts.action || null }];
  emit();
  setTimeout(() => dismissToast(id), opts.timeout || (opts.action ? 8000 : 4000));
}

export function dismissToast(id) {
  state.toasts = state.toasts.filter((x) => x.id !== id);
  emit();
}

let errorHandler = (e) => console.error(e);
export function onError(fn) {
  errorHandler = fn;
}

async function persist(fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    errorHandler(e);
    return false;
  }
}

export const liveTasks = () => state.tasks.filter((t) => !t.deleted);
export const liveProjects = () => state.projects.filter((p) => !p.deleted).sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
export const findTask = (id) => state.tasks.find((t) => t.id === id && !t.deleted);
export const findProject = (id) => state.projects.find((p) => p.id === id && !p.deleted);

const OLD_SEED_COLORS = {
  '#2f6f8f': '#0891b2', '#7a4f9a': '#9333ea', '#2f8f5b': '#16a34a',
  '#3b6fc4': '#2563eb', '#b5672c': '#db2777', '#ea580c': '#db2777', '#8f2f4a': '#e11d48',
};

export async function init() {
  try {
    const browserLang = (globalThis.navigator && navigator.language) || 'en';
    const device = await db.getKV('device');
    state.device = { ...defaultDevice(browserLang.toLowerCase().startsWith('fr') ? 'fr' : 'en'), ...(device || {}) };
    state.device.sync = { ...defaultDevice().sync, ...((device && device.sync) || {}) };
    const prefs = await db.getKV('prefs');
    state.prefs = prefs ? validatePrefs(prefs, defaultPrefs()) : defaultPrefs();
    state.tasks = await db.getAll('tasks');
    state.projects = await db.getAll('projects');
    // v1.3: the bright light look is the default, even when the phone is in dark mode.
    // Switch once from "follow system" to light; a later choice in Settings is kept.
    if (!(await db.getKV('lightDefault'))) {
      if (state.device.theme === 'system') {
        state.device.theme = 'light';
        await db.setKV('device', state.device);
      }
      await db.setKV('lightDefault', true);
    }
    if (!(await db.getKV('seeded'))) {
      const seeds = seedProjects(state.device.lang);
      const have = new Set(state.projects.map((p) => p.id));
      const add = seeds.filter((p) => !have.has(p.id));
      await db.putMany('projects', add);
      await db.setKV('seeded', true);
      await db.setKV('device', state.device);
      state.projects = [...state.projects, ...add];
    }
    // v1.1/1.2: brighten the default project colours, but only where the user kept the original colour.
    const recolor = [];
    for (const p of state.projects) {
      const c = OLD_SEED_COLORS[p.color];
      if (c && p.id.startsWith('proj_default_')) recolor.push({ ...p, color: c, updatedAt: nowISO() });
    }
    if (recolor.length) {
      await db.putMany('projects', recolor);
      const byId = new Map(recolor.map((p) => [p.id, p]));
      state.projects = state.projects.map((p) => byId.get(p.id) || p);
    }
    if (globalThis.navigator && navigator.storage && navigator.storage.persist) {
      try {
        state.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
      } catch {
        state.persisted = null;
      }
    }
    state.ready = true;
    emit();
  } catch (e) {
    state.fatal = e && e.message ? e.message : String(e);
    emit();
  }
}

// ---------- tasks ----------

function stamp(rec) {
  return { ...rec, updatedAt: nowISO() };
}

async function saveTasks(list) {
  const ids = new Map(list.map((t) => [t.id, t]));
  state.tasks = state.tasks.map((t) => ids.get(t.id) || t);
  for (const t of list) if (!state.tasks.some((x) => x.id === t.id)) state.tasks.push(t);
  emit();
  const ok = await persist(() => db.putMany('tasks', list));
  if (ok) scheduleSync();
  return ok;
}

export async function createTask(fields) {
  const t = makeTask({ priority: state.prefs.defaultPriority, ...fields });
  if (!fields.reminders && state.prefs.defaultReminderMinutes != null && t.dueDate) {
    t.reminders = [makeReminder({ kind: 'before', minutes: state.prefs.defaultReminderMinutes })];
  }
  await saveTasks([t]);
  return t;
}

/** Update a task. Moving a deadline later counts as a postponement. */
export async function updateTask(id, patch) {
  const old = state.tasks.find((t) => t.id === id);
  if (!old) return null;
  const next = stamp({ ...old, ...patch });
  const dueChanged = next.dueDate !== old.dueDate || next.dueTime !== old.dueTime;
  if (dueChanged) {
    const key = (t) => (t.dueDate ? `${t.dueDate}T${t.dueTime || '23:59'}` : null);
    if (key(old) && key(next) && key(next) > key(old)) next.postponeCount = (old.postponeCount || 0) + 1;
    next.reminders = (next.reminders || []).map((r) => (r.kind === 'before' ? { ...r, snoozedUntil: null } : r));
  }
  if (next.done && !old.done) next.completedAt = nowISO();
  if (!next.done) next.completedAt = null;
  await saveTasks([next]);
  return next;
}

export async function setDone(id, done) {
  return updateTask(id, { done });
}

export async function deleteTask(id) {
  const old = state.tasks.find((t) => t.id === id);
  if (!old) return null;
  const tomb = { id, deleted: true, createdAt: old.createdAt, updatedAt: nowISO() };
  await saveTasks([tomb]);
  return old;
}

export async function restoreTask(old) {
  await saveTasks([stamp({ ...old, deleted: false })]);
}

export async function duplicateTask(id, suffix) {
  const o = findTask(id);
  if (!o) return null;
  const copy = makeTask({
    ...o,
    id: undefined,
    title: `${o.title} ${suffix}`.trim(),
    done: false,
    completedAt: null,
    postponeCount: 0,
    reminders: o.reminders.map((r) => ({ ...r, id: newId('rem'), firedFor: null, snoozedUntil: null })),
    checklist: o.checklist.map((c) => ({ ...c, id: newId('chk'), done: false })),
    createdAt: undefined,
    updatedAt: undefined,
  });
  const fresh = makeTask();
  copy.id = fresh.id;
  copy.createdAt = fresh.createdAt;
  copy.updatedAt = fresh.updatedAt;
  await saveTasks([copy]);
  return copy;
}

// ---------- reminders ----------

export async function markReminders(items) {
  const byTask = new Map();
  for (const { task, reminder, key } of items) {
    const cur = byTask.get(task.id) || state.tasks.find((t) => t.id === task.id);
    byTask.set(task.id, { ...cur, reminders: cur.reminders.map((r) => (r.id === reminder.id ? { ...r, firedFor: key } : r)) });
  }
  if (byTask.size) await saveTasks([...byTask.values()].map(stamp));
}

export async function snoozeReminder(taskId, reminderId, minutes) {
  const t = findTask(taskId);
  if (!t) return;
  const until = snoozeUntil(new Date(), minutes);
  dismissAlert(taskId, reminderId);
  await saveTasks([stamp({ ...t, reminders: t.reminders.map((r) => (r.id === reminderId ? { ...r, snoozedUntil: until } : r)) })]);
}

export function dismissAlert(taskId, reminderId) {
  state.alerts = state.alerts.filter((a) => !(a.taskId === taskId && a.reminderId === reminderId));
  emit();
}

let notify = null;
export function setNotifier(fn) {
  notify = fn;
}

/** Called on open, every 30 s while open, and when the app comes back to the foreground. */
export async function checkReminders(now = new Date()) {
  if (!state.ready) return;
  const due = dueReminders(liveTasks(), now);
  if (!due.length) return;
  for (const d of due) {
    if (!state.alerts.some((a) => a.taskId === d.task.id && a.reminderId === d.reminder.id)) {
      state.alerts = [...state.alerts, { taskId: d.task.id, reminderId: d.reminder.id, time: d.time.toISOString() }];
    }
    if (notify) notify(d);
  }
  emit();
  await markReminders(due);
}

// ---------- projects ----------

async function saveProjects(list) {
  const ids = new Map(list.map((p) => [p.id, p]));
  state.projects = state.projects.map((p) => ids.get(p.id) || p);
  for (const p of list) if (!state.projects.some((x) => x.id === p.id)) state.projects.push(p);
  emit();
  const ok = await persist(() => db.putMany('projects', list));
  if (ok) scheduleSync();
  return ok;
}

export async function createProject(fields) {
  const maxOrder = Math.max(-1, ...liveProjects().map((p) => p.order));
  const p = makeProject({ ...fields, order: maxOrder + 1 });
  await saveProjects([p]);
  return p;
}

export async function updateProject(id, patch) {
  const old = findProject(id);
  if (!old) return null;
  const next = stamp({ ...old, ...patch });
  await saveProjects([next]);
  return next;
}

export async function moveProject(id, dir) {
  const list = liveProjects().filter((p) => !p.archived);
  const i = list.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const reordered = [...list];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  const changed = reordered.map((p, k) => (p.order === k ? null : stamp({ ...p, order: k }))).filter(Boolean);
  await saveProjects(changed);
}

/** Delete a project; its tasks stay and move to "No project". */
export async function deleteProject(id) {
  const p = findProject(id);
  if (!p) return;
  const moved = liveTasks().filter((t) => t.projectId === id).map((t) => stamp({ ...t, projectId: null }));
  if (moved.length) await saveTasks(moved);
  await saveProjects([{ id, deleted: true, createdAt: p.createdAt, updatedAt: nowISO() }]);
}

// ---------- settings ----------

export async function setPrefs(patch) {
  state.prefs = { ...state.prefs, ...patch, updatedAt: nowISO() };
  emit();
  if (await persist(() => db.setKV('prefs', state.prefs))) scheduleSync();
}

/** Turn on sync on this device from another device's pairing code and the shared passphrase. */
export async function connectWithPairCode(code, passphrase) {
  const token = await readPairCode(code, passphrase);
  state.pairCode = null;
  await setDevice({ sync: { enabled: true, token, passphrase, gistId: '', lastError: null } });
  return syncNow({ manual: true });
}

export async function setDevice(patch) {
  state.device = { ...state.device, ...patch, sync: { ...state.device.sync, ...(patch.sync || {}) } };
  emit();
  await persist(() => db.setKV('device', state.device));
}

// ---------- backup ----------

export function exportJSON() {
  return JSON.stringify(buildExport({ tasks: state.tasks, projects: state.projects, prefs: state.prefs }), null, 2);
}

export function previewImport(text, mode) {
  return planImport(text, { tasks: state.tasks, projects: state.projects }, mode, defaultPrefs());
}

export async function applyImport(plan, mode) {
  await db.replaceAll({ tasks: plan.tasks, projects: plan.projects });
  state.tasks = plan.tasks;
  state.projects = plan.projects;
  if (plan.prefs && (mode === 'replace' || plan.prefs.updatedAt > state.prefs.updatedAt)) {
    state.prefs = plan.prefs;
    await db.setKV('prefs', state.prefs);
  }
  emit();
  scheduleSync();
}

/** Delete everything stored on this device, then restore the default projects. Sync is switched off. */
export async function wipeEverything() {
  await db.wipeAll();
  const lang = state.device.lang;
  state.device = defaultDevice(lang);
  state.prefs = defaultPrefs();
  state.tasks = [];
  state.projects = seedProjects(lang);
  state.alerts = [];
  await db.putMany('projects', state.projects);
  await db.setKV('seeded', true);
  await db.setKV('device', state.device);
  emit();
}

// ---------- sync ----------

let syncTimer = null;
let syncAgain = false;

export function scheduleSync(delay = 4000) {
  const s = state.device.sync;
  if (!s.enabled || !s.token || !s.passphrase) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), delay);
}

function validateRemote(raw) {
  let rejected = 0;
  const v = (list, fn) => (Array.isArray(list) ? list : []).map(fn).filter((r) => (r.ok ? true : (rejected++, false))).map((r) => r.value);
  const out = { tasks: v(raw.tasks, validateTask), projects: v(raw.projects, validateProject), prefs: raw.prefs ? validatePrefs(raw.prefs, defaultPrefs()) : null };
  out.rejected = rejected;
  return out;
}

export async function syncNow({ manual = false, fetchFn } = {}) {
  const s = state.device.sync;
  if (!s.enabled) return false;
  if (state.sync.running) { syncAgain = true; return false; }
  if (globalThis.navigator && navigator.onLine === false) {
    await setDevice({ sync: { lastError: 'offline' } });
    return false;
  }
  state.sync = { running: true };
  emit();
  try {
    const startTasks = state.tasks;
    const startProjects = state.projects;
    const res = await syncOnce({ tasks: state.tasks, projects: state.projects, prefs: state.prefs }, {
      token: s.token, passphrase: s.passphrase, gistId: s.gistId, fetchFn, validate: validateRemote,
    });
    // Keep edits made while the sync was running, and sync again afterwards to upload them.
    const editedDuring = state.tasks !== startTasks || state.projects !== startProjects;
    if (res.localChanged || editedDuring) {
      const tasks = state.tasks === startTasks ? res.state.tasks : mergeRecords(state.tasks, res.state.tasks).merged;
      const projects = state.projects === startProjects ? res.state.projects : mergeRecords(state.projects, res.state.projects).merged;
      await db.replaceAll({ tasks, projects });
      state.tasks = tasks;
      state.projects = projects;
    }
    if (editedDuring) syncAgain = true;
    if (res.state.prefs && res.state.prefs.updatedAt > state.prefs.updatedAt) {
      state.prefs = res.state.prefs;
      await db.setKV('prefs', state.prefs);
    }
    await setDevice({ sync: { gistId: res.gistId, lastSync: nowISO(), lastError: null } });
    return true;
  } catch (e) {
    await setDevice({ sync: { lastError: e.code || 'unknown' } });
    if (manual) throw e;
    return false;
  } finally {
    state.sync = { running: false };
    emit();
    if (syncAgain) { syncAgain = false; scheduleSync(1500); }
  }
}
