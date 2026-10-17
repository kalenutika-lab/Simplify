// Progress figures, all counted from stored records. No invented scores.
import { todayYMD, toYMD, startOfWeek, diffDays, addDays } from './dates.js';
import { deadlineInfo } from './scoring.js';

const live = (x) => x && !x.deleted;
const completedDay = (t) => (t.completedAt ? toYMD(new Date(t.completedAt)) : null);

export function projectStats(project, tasks, now = new Date()) {
  const mine = tasks.filter((t) => live(t) && t.projectId === project.id);
  const done = mine.filter((t) => t.done);
  const open = mine.filter((t) => !t.done);
  const overdue = open.filter((t) => deadlineInfo(t, now).status === 'overdue');
  const days = done.map(completedDay).filter(Boolean).sort();
  const lastDone = days.length ? days[days.length - 1] : null;
  const today = todayYMD(now);
  const total = mine.length;
  const oldestOpen = open.map((t) => toYMD(new Date(t.createdAt))).sort()[0] || null;
  return {
    daysSinceFirstOpen: oldestOpen ? diffDays(oldestOpen, today) : null,
    total,
    done: done.length,
    open: open.length,
    overdue: overdue.length,
    percent: total ? Math.round((done.length / total) * 100) : 0,
    lastDone,
    daysSinceDone: lastDone ? diffDays(lastDone, today) : null,
    estimateOpenMin: open.reduce((s, t) => s + (Number(t.estimateMin) || 0), 0),
  };
}

/**
 * A project is "falling behind" when it has overdue tasks, its target date has
 * passed with work left, or it has open tasks and nothing completed in `staleDays` days.
 * Returns the reasons so the screen can say why.
 */
export function behindReasons(project, stats, now = new Date(), staleDays = 7) {
  if (project.archived || project.deleted) return [];
  const today = todayYMD(now);
  const out = [];
  if (stats.overdue > 0) out.push({ key: 'projOverdue', params: { count: stats.overdue } });
  if (project.targetDate && project.targetDate < today && stats.open > 0) out.push({ key: 'projTargetPassed', params: { date: project.targetDate } });
  // Stale: nothing completed for `staleDays` days. A project with no completion yet only
  // counts once its oldest open task has waited that long, so brand-new projects are not flagged.
  if (stats.open > 0) {
    if (stats.daysSinceDone !== null && stats.daysSinceDone >= staleDays) out.push({ key: 'projStale', params: { days: stats.daysSinceDone } });
    else if (stats.daysSinceDone === null && stats.daysSinceFirstOpen >= staleDays) out.push({ key: 'projNeverDone', params: { days: stats.daysSinceFirstOpen } });
  }
  return out;
}

export function overview(tasks, projects, prefs, now = new Date()) {
  const today = todayYMD(now);
  const weekStart = startOfWeek(today, prefs.weekStart ?? 1);
  const all = tasks.filter(live);
  const open = all.filter((t) => !t.done);
  const statusOf = (t) => deadlineInfo(t, now);
  const in7 = addDays(today, 7);
  const activeProjects = projects.filter((p) => live(p) && !p.archived).sort((a, b) => a.order - b.order);
  const per = activeProjects.map((p) => {
    const s = projectStats(p, all, now);
    return { project: p, stats: s, behind: behindReasons(p, s, now) };
  });
  return {
    today,
    weekStart,
    doneToday: all.filter((t) => t.done && completedDay(t) === today).length,
    doneWeek: all.filter((t) => t.done && completedDay(t) && completedDay(t) >= weekStart && completedDay(t) <= today).length,
    open: open.length,
    overdue: open.filter((t) => statusOf(t).status === 'overdue').length,
    dueToday: open.filter((t) => statusOf(t).status === 'today').length,
    upcoming7: open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= in7).length,
    noDeadline: open.filter((t) => !t.dueDate).length,
    openEstimateMin: open.reduce((s, t) => s + (Number(t.estimateMin) || 0), 0),
    openWithoutEstimate: open.filter((t) => !Number(t.estimateMin)).length,
    projects: per,
    stale: per.filter((x) => x.behind.some((b) => b.key === 'projStale' || b.key === 'projNeverDone')),
    behind: per.filter((x) => x.behind.length > 0),
    postponed: open.filter((t) => (t.postponeCount || 0) >= 2).sort((a, b) => b.postponeCount - a.postponeCount),
  };
}
