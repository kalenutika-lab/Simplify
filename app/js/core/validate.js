// Validation and normalisation of records coming from imports or sync.
// Invalid records are rejected with a reason; nothing half-valid is stored.
import { isValidYMD, isValidHM, fromLocalISO } from './dates.js';
import { PRIORITIES, MANUAL, makeTask, makeProject, SCHEMA_VERSION } from './model.js';

const isStr = (v) => typeof v === 'string';
const isISO = (v) => isStr(v) && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
const ID_RE = /^[A-Za-z0-9_\-:.]{1,100}$/;
const MAX_TEXT = 20000;

function text(v, max = MAX_TEXT) {
  if (v === undefined || v === null) return '';
  if (!isStr(v)) throw new Error('notText');
  return v.slice(0, max);
}

function links(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error('badLinks');
  return v.filter((x) => isStr(x) && x.trim()).map((x) => x.trim().slice(0, 2000)).slice(0, 50);
}

function reminder(r) {
  if (!r || typeof r !== 'object') throw new Error('badReminder');
  if (!isStr(r.id) || !ID_RE.test(r.id)) throw new Error('badReminder');
  if (r.kind === 'before') {
    const m = Number(r.minutes);
    if (!Number.isFinite(m) || m < 0 || m > 60 * 24 * 60) throw new Error('badReminder');
  } else if (r.kind === 'at') {
    if (!fromLocalISO(r.at)) throw new Error('badReminder');
  } else throw new Error('badReminder');
  return {
    id: r.id,
    kind: r.kind,
    minutes: r.kind === 'before' ? Math.round(Number(r.minutes)) : null,
    at: r.kind === 'at' ? r.at : null,
    enabled: r.enabled !== false,
    snoozedUntil: r.snoozedUntil && fromLocalISO(r.snoozedUntil) ? r.snoozedUntil : null,
    firedFor: isStr(r.firedFor) ? r.firedFor : null,
  };
}

/** Returns { ok: true, value } or { ok: false, reason }. */
export function validateTask(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'notObject' };
    if (!isStr(raw.id) || !ID_RE.test(raw.id)) return { ok: false, reason: 'badId' };
    if (!isISO(raw.updatedAt) || !isISO(raw.createdAt)) return { ok: false, reason: 'badTimestamps' };
    if (raw.deleted === true) return { ok: true, value: { id: raw.id, deleted: true, createdAt: raw.createdAt, updatedAt: raw.updatedAt } };
    const title = isStr(raw.title) ? raw.title.trim() : '';
    if (!title) return { ok: false, reason: 'noTitle' };
    if (raw.dueDate != null && !isValidYMD(raw.dueDate)) return { ok: false, reason: 'badDate' };
    if (raw.dueTime != null && !isValidHM(raw.dueTime)) return { ok: false, reason: 'badTime' };
    if (raw.dueTime && !raw.dueDate) return { ok: false, reason: 'timeWithoutDate' };
    if (raw.priority != null && !PRIORITIES.includes(raw.priority)) return { ok: false, reason: 'badPriority' };
    let est = raw.estimateMin;
    if (est != null && est !== '') {
      est = Number(est);
      if (!Number.isFinite(est) || est < 0 || est > 60 * 24 * 7) return { ok: false, reason: 'badEstimate' };
    } else est = null;
    if (raw.done && raw.completedAt != null && !isISO(raw.completedAt)) return { ok: false, reason: 'badTimestamps' };
    const checklist = (Array.isArray(raw.checklist) ? raw.checklist : []).map((c) => {
      if (!c || !isStr(c.id) || !isStr(c.text)) throw new Error('badChecklist');
      return { id: c.id, text: c.text.slice(0, 500), done: !!c.done };
    });
    const value = makeTask({
      id: raw.id,
      title: title.slice(0, 500),
      description: text(raw.description),
      projectId: isStr(raw.projectId) && raw.projectId ? raw.projectId : null,
      dueDate: raw.dueDate || null,
      dueTime: raw.dueTime || null,
      priority: raw.priority || 'medium',
      mandatory: !!raw.mandatory,
      estimateMin: est ? Math.round(est) : null,
      reminders: (Array.isArray(raw.reminders) ? raw.reminders : []).map(reminder),
      checklist,
      blockedBy: (Array.isArray(raw.blockedBy) ? raw.blockedBy : []).filter((x) => isStr(x) && ID_RE.test(x) && x !== raw.id),
      notes: text(raw.notes),
      links: links(raw.links),
      done: !!raw.done,
      completedAt: raw.done ? raw.completedAt || raw.updatedAt : null,
      manual: MANUAL.includes(raw.manual) ? raw.manual : 'normal',
      postponeCount: Number.isInteger(raw.postponeCount) && raw.postponeCount >= 0 ? raw.postponeCount : 0,
      deleted: false,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
    return { ok: true, value };
  } catch (e) {
    return { ok: false, reason: e.message || 'invalid' };
  }
}

export function validateProject(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'notObject' };
    if (!isStr(raw.id) || !ID_RE.test(raw.id)) return { ok: false, reason: 'badId' };
    if (!isISO(raw.updatedAt) || !isISO(raw.createdAt)) return { ok: false, reason: 'badTimestamps' };
    if (raw.deleted === true) return { ok: true, value: { id: raw.id, deleted: true, createdAt: raw.createdAt, updatedAt: raw.updatedAt } };
    const name = isStr(raw.name) ? raw.name.trim() : '';
    if (!name) return { ok: false, reason: 'noName' };
    if (raw.targetDate != null && !isValidYMD(raw.targetDate)) return { ok: false, reason: 'badDate' };
    if (raw.priority != null && !PRIORITIES.includes(raw.priority)) return { ok: false, reason: 'badPriority' };
    const boost = raw.boost == null ? 0 : Number(raw.boost);
    if (!Number.isFinite(boost) || boost < -100 || boost > 100) return { ok: false, reason: 'badBoost' };
    return {
      ok: true,
      value: makeProject({
        id: raw.id,
        name: name.slice(0, 200),
        description: text(raw.description),
        objective: text(raw.objective),
        priority: raw.priority || 'medium',
        mandatory: !!raw.mandatory,
        boost,
        color: isStr(raw.color) && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : '#5b6b7a',
        targetDate: raw.targetDate || null,
        notes: text(raw.notes),
        links: links(raw.links),
        order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
        archived: !!raw.archived,
        deleted: false,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      }),
    };
  } catch (e) {
    return { ok: false, reason: e.message || 'invalid' };
  }
}

export function validatePrefs(raw, defaults) {
  if (!raw || typeof raw !== 'object') return null;
  const out = { ...defaults, id: 'prefs' };
  if (PRIORITIES.includes(raw.defaultPriority)) out.defaultPriority = raw.defaultPriority;
  if (raw.weekStart === 0 || raw.weekStart === 1) out.weekStart = raw.weekStart;
  for (const k of ['focusWeekday', 'focusWeekend']) {
    const v = Number(raw[k]);
    if (Number.isFinite(v) && v >= 0 && v <= 24 * 60) out[k] = Math.round(v);
  }
  if (raw.weights && typeof raw.weights === 'object') {
    out.weights = { ...defaults.weights };
    for (const k of Object.keys(defaults.weights)) {
      const v = Number(raw.weights[k]);
      if (Number.isFinite(v) && Math.abs(v) <= 100000) out.weights[k] = v;
    }
  }
  const dr = raw.defaultReminderMinutes;
  out.defaultReminderMinutes = dr == null ? null : Number.isFinite(Number(dr)) && dr >= 0 ? Number(dr) : null;
  if (isISO(raw.updatedAt)) out.updatedAt = raw.updatedAt;
  return out;
}

/** Build an export file object. */
export function buildExport(state, now = new Date()) {
  return {
    app: 'personal-project-manager',
    schema: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    projects: state.projects,
    tasks: state.tasks,
    prefs: state.prefs,
  };
}

/**
 * Plan an import without changing anything. mode: 'merge' or 'replace'.
 * Returns { error } for unusable files, otherwise { tasks, projects, prefs, report }.
 * report lists added / updated / unchanged / older (kept local) / rejected with reasons.
 */
export function planImport(fileText, existing, mode = 'merge', defaultsPrefs) {
  let data;
  try {
    data = JSON.parse(fileText);
  } catch {
    return { error: 'notJson' };
  }
  if (!data || typeof data !== 'object' || data.app !== 'personal-project-manager') return { error: 'notOurFile' };
  if (typeof data.schema !== 'number' || data.schema > SCHEMA_VERSION) return { error: 'newerSchema' };
  if (!Array.isArray(data.tasks) || !Array.isArray(data.projects)) return { error: 'missingLists' };

  const report = { added: 0, updated: 0, unchanged: 0, keptLocal: 0, rejected: [], warnings: [] };
  const base = mode === 'replace' ? { tasks: [], projects: [] } : existing;

  function mergeList(rawList, current, validate, kind) {
    const byId = new Map(current.map((r) => [r.id, r]));
    const seen = new Set();
    rawList.forEach((raw, index) => {
      const label = raw && typeof raw === 'object' ? raw.title || raw.name || raw.id || `#${index + 1}` : `#${index + 1}`;
      const v = validate(raw);
      if (!v.ok) { report.rejected.push({ kind, index: index + 1, label: String(label).slice(0, 80), reason: v.reason }); return; }
      const rec = v.value;
      if (seen.has(rec.id)) { report.rejected.push({ kind, index: index + 1, label: String(label).slice(0, 80), reason: 'duplicateInFile' }); return; }
      seen.add(rec.id);
      const cur = byId.get(rec.id);
      if (!cur) { byId.set(rec.id, rec); report.added++; return; }
      if (JSON.stringify(cur) === JSON.stringify(rec)) { report.unchanged++; return; }
      if (rec.updatedAt > cur.updatedAt) { byId.set(rec.id, rec); report.updated++; } else report.keptLocal++;
    });
    return [...byId.values()];
  }

  const projects = mergeList(data.projects, base.projects, validateProject, 'project');
  const projectIds = new Set(projects.filter((p) => !p.deleted).map((p) => p.id));
  let tasks = mergeList(data.tasks, base.tasks, validateTask, 'task');
  tasks = tasks.map((t) => {
    if (!t.deleted && t.projectId && !projectIds.has(t.projectId)) {
      report.warnings.push({ key: 'missingProject', label: t.title });
      return { ...t, projectId: null };
    }
    return t;
  });
  const prefs = data.prefs ? validatePrefs(data.prefs, defaultsPrefs) : null;
  return { tasks, projects, prefs, report };
}
