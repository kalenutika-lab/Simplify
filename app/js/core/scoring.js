// Deterministic, explainable priority scoring. Same data + same clock = same order.
import { DEFAULT_WEIGHTS } from './model.js';
import { todayYMD, diffDays, toHM } from './dates.js';

/**
 * Deadline status relative to `now`:
 * overdue  - date before today, or today with a time already passed
 * today    - due today (time not passed or no time)
 * upcoming - due in the future
 * none     - no deadline
 */
export function deadlineInfo(task, now = new Date()) {
  if (!task.dueDate) return { status: 'none', days: null };
  const today = todayYMD(now);
  const days = diffDays(today, task.dueDate);
  if (days < 0) return { status: 'overdue', days };
  if (days === 0) {
    if (task.dueTime && task.dueTime < toHM(now)) return { status: 'overdue', days: 0 };
    return { status: 'today', days: 0 };
  }
  return { status: 'upcoming', days };
}

function urgency(info, w) {
  if (info.status === 'none') return { key: 'noDeadline', points: w.noDeadline };
  if (info.status === 'overdue') {
    const late = -info.days;
    const extra = Math.min(late * w.overduePerDay, w.overdueMaxExtra);
    return { key: 'overdue', points: w.overdueBase + extra, params: { days: late } };
  }
  const d = info.days;
  if (d === 0) return { key: 'today', points: w.today };
  if (d === 1) return { key: 'tomorrow', points: w.tomorrow };
  if (d <= 3) return { key: 'dueIn', points: w.days2to3, params: { days: d } };
  if (d <= 7) return { key: 'dueIn', points: w.days4to7, params: { days: d } };
  if (d <= 14) return { key: 'dueIn', points: w.days8to14, params: { days: d } };
  if (d <= 30) return { key: 'dueIn', points: w.days15to30, params: { days: d } };
  return { key: 'dueIn', points: w.days31plus, params: { days: d } };
}

export const isOpen = (t) => t && !t.deleted && !t.done;

/**
 * Score one task. ctx: { now, weights, projectsById, blocksCount }
 * Returns { score, reasons: [{key, points, params}], info }
 */
export function scoreTask(task, ctx) {
  const w = { ...DEFAULT_WEIGHTS, ...(ctx.weights || {}) };
  const info = deadlineInfo(task, ctx.now);
  const reasons = [urgency(info, w)];
  const pr = task.priority in { high: 1, medium: 1, low: 1 } ? task.priority : 'medium';
  reasons.push({ key: `prio_${pr}`, points: w[pr] });
  if (task.mandatory) reasons.push({ key: 'mandatory', points: w.mandatory });
  const project = task.projectId && ctx.projectsById ? ctx.projectsById.get(task.projectId) : null;
  if (project && project.boost) reasons.push({ key: 'projectBoost', points: Number(project.boost) || 0, params: { name: project.name } });
  const blocks = (ctx.blocksCount && ctx.blocksCount.get(task.id)) || 0;
  if (blocks > 0) reasons.push({ key: 'blocks', points: Math.min(blocks * w.blockerPer, w.blockerMax), params: { count: blocks } });
  if (task.manual === 'pin') reasons.push({ key: 'pinned', points: w.manual });
  if (task.manual === 'later') reasons.push({ key: 'later', points: -w.manual });
  const score = reasons.reduce((s, r) => s + r.points, 0);
  return { score, reasons: reasons.filter((r) => r.points !== 0 || r.key === 'noDeadline'), info };
}

/** For each open task id, how many other open tasks it blocks. */
export function blockerCounts(openTasks) {
  const openIds = new Set(openTasks.map((t) => t.id));
  const counts = new Map();
  for (const t of openTasks) {
    for (const b of t.blockedBy || []) {
      if (b !== t.id && openIds.has(b)) counts.set(b, (counts.get(b) || 0) + 1);
    }
  }
  return counts;
}

function deadlineKey(t) {
  if (!t.dueDate) return '9999-99-99T99:99';
  return `${t.dueDate}T${t.dueTime || '23:59'}`;
}

/**
 * Rank open tasks. Tasks in archived projects are left out of the active list.
 * Tie-break: earlier deadline, then older task, then id.
 */
export function rankTasks(tasks, projects, prefs, now = new Date()) {
  const projectsById = new Map(projects.filter((p) => !p.deleted).map((p) => [p.id, p]));
  const open = tasks.filter((t) => isOpen(t) && !(t.projectId && projectsById.get(t.projectId)?.archived));
  const blocksCount = blockerCounts(open);
  const openById = new Map(open.map((t) => [t.id, t]));
  const ctx = { now, weights: prefs && prefs.weights, projectsById, blocksCount };
  const ranked = open.map((task) => {
    const s = scoreTask(task, ctx);
    const waitingOn = (task.blockedBy || []).filter((id) => id !== task.id && openById.has(id));
    return { task, score: s.score, reasons: s.reasons, status: s.info.status, days: s.info.days, waitingOn };
  });
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = deadlineKey(a.task), db = deadlineKey(b.task);
    if (da !== db) return da < db ? -1 : 1;
    if (a.task.createdAt !== b.task.createdAt) return a.task.createdAt < b.task.createdAt ? -1 : 1;
    return a.task.id < b.task.id ? -1 : 1;
  });
  return ranked;
}

/** Top N tasks to work on: highest ranked that are not waiting on another open task. */
export function topTasks(ranked, n = 3) {
  return ranked.filter((r) => r.waitingOn.length === 0).slice(0, n);
}

/**
 * "What fits in my day": walk the ranked list (not waiting on others) and take tasks
 * whose estimates fit the remaining focus minutes. Nothing is scheduled; this is only a view.
 */
export function fitDay(ranked, capacityMin, limit = 20) {
  let left = capacityMin;
  const fits = [];
  const noEstimate = [];
  const tooBig = [];
  for (const r of ranked.filter((x) => x.waitingOn.length === 0).slice(0, limit)) {
    const est = Number(r.task.estimateMin) || 0;
    if (!est) { noEstimate.push(r); continue; }
    if (est <= left) { fits.push(r); left -= est; } else tooBig.push(r);
  }
  return { capacity: capacityMin, used: capacityMin - left, left, fits, noEstimate, tooBig };
}

export function focusMinutesFor(ymd, prefs, isWeekendFn) {
  return isWeekendFn(ymd) ? prefs.focusWeekend : prefs.focusWeekday;
}

