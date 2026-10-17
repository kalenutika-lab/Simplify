// Unit tests for dates, scoring, reminders, stats and calendar export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../app/js/core/dates.js';
import { rankTasks, topTasks, fitDay, deadlineInfo } from '../../app/js/core/scoring.js';
import { makeTask, makeProject, defaultPrefs, makeReminder, seedProjects } from '../../app/js/core/model.js';
import { dueReminders, reminderTime, upcomingReminders } from '../../app/js/core/reminders.js';
import { overview, projectStats, behindReasons } from '../../app/js/core/stats.js';
import { buildICS, googleCalendarUrl } from '../../app/js/core/ics.js';

const NOW = new Date(2026, 9, 17, 10, 0); // Sat 17/10/2026 10:00 local
const prefs = defaultPrefs();
const T = (f) => makeTask({ createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...f });

test('dates: validation and parsing', () => {
  assert.equal(D.isValidYMD('2026-02-29'), false);
  assert.equal(D.isValidYMD('2028-02-29'), true);
  assert.equal(D.isValidYMD('2026-13-01'), false);
  assert.equal(D.parseDMY('31/02/2026'), null);
  assert.equal(D.parseDMY('5/11/26'), '2026-11-05');
  assert.equal(D.parseDMY('05.11.2026'), '2026-11-05');
  assert.equal(D.parseHM('18h30'), '18:30');
  assert.equal(D.parseHM('24:00'), null);
  assert.equal(D.formatDMY('2026-10-17'), '17/10/2026');
});

test('dates: calendar arithmetic is daylight-saving safe', () => {
  // Europe DST ends 25/10/2026, US DST ends 01/11/2026.
  assert.equal(D.addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(D.addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(D.diffDays('2026-10-20', '2026-11-03'), 14);
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.startOfWeek('2026-10-17', 1), '2026-10-12');
  assert.equal(D.startOfWeek('2026-10-17', 0), '2026-10-11');
  assert.equal(D.startOfWeek('2026-10-18', 1), '2026-10-12');
});

test('deadline status: overdue, today, time passed, none', () => {
  assert.equal(deadlineInfo(T({ dueDate: '2026-10-16' }), NOW).status, 'overdue');
  assert.equal(deadlineInfo(T({ dueDate: '2026-10-17' }), NOW).status, 'today');
  assert.equal(deadlineInfo(T({ dueDate: '2026-10-17', dueTime: '09:00' }), NOW).status, 'overdue');
  assert.equal(deadlineInfo(T({ dueDate: '2026-10-17', dueTime: '11:00' }), NOW).status, 'today');
  assert.equal(deadlineInfo(T({}), NOW).status, 'none');
  // Late evening: still "today" until midnight local time.
  assert.equal(deadlineInfo(T({ dueDate: '2026-10-17' }), new Date(2026, 9, 17, 23, 59)).status, 'today');
  assert.equal(deadlineInfo(T({ dueDate: '2026-10-17' }), new Date(2026, 9, 18, 0, 0)).status, 'overdue');
});

test('ranking: overdue > today > upcoming, completed and deleted leave the list', () => {
  const tasks = [
    T({ id: 'up', title: 'up', dueDate: '2026-10-25' }),
    T({ id: 'od', title: 'od', dueDate: '2026-10-15' }),
    T({ id: 'td', title: 'td', dueDate: '2026-10-17' }),
    T({ id: 'nd', title: 'nd' }),
    T({ id: 'dn', title: 'dn', dueDate: '2026-10-15', done: true }),
    { id: 'del', deleted: true, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' },
  ];
  const r = rankTasks(tasks, [], prefs, NOW).map((x) => x.task.id);
  assert.deepEqual(r, ['od', 'td', 'up', 'nd']);
});

test('ranking: importance breaks comparable urgency; mandatory adds weight', () => {
  const tasks = [
    T({ id: 'low', title: 'a', dueDate: '2026-10-20', priority: 'low' }),
    T({ id: 'high', title: 'b', dueDate: '2026-10-20', priority: 'high' }),
    T({ id: 'med-mand', title: 'c', dueDate: '2026-10-20', priority: 'medium', mandatory: true }),
  ];
  const r = rankTasks(tasks, [], prefs, NOW);
  assert.deepEqual(r.map((x) => x.task.id), ['high', 'med-mand', 'low']);
  assert.equal(r[0].score, 45 + 30);
  assert.equal(r[1].score, 45 + 15 + 15);
});

test('ranking: mandatory does not override a far deadline vs an overdue task', () => {
  const tasks = [
    T({ id: 'far', title: 'far', dueDate: '2026-12-31', priority: 'high', mandatory: true }),
    T({ id: 'late', title: 'late', dueDate: '2026-10-16', priority: 'low' }),
  ];
  assert.equal(rankTasks(tasks, [], prefs, NOW)[0].task.id, 'late');
});

test('ranking: manual pin and push-down override the score', () => {
  const tasks = [
    T({ id: 'od', title: 'od', dueDate: '2026-10-10', priority: 'high' }),
    T({ id: 'pin', title: 'pin', manual: 'pin', priority: 'low' }),
    T({ id: 'later', title: 'later', manual: 'later', dueDate: '2026-10-17' }),
    T({ id: 'nd', title: 'nd' }),
  ];
  assert.deepEqual(rankTasks(tasks, [], prefs, NOW).map((x) => x.task.id), ['pin', 'od', 'nd', 'later']);
});

test('ranking: project boost and blockers, with reasons', () => {
  const p = makeProject({ id: 'p1', name: 'Case Study', boost: 10 });
  const tasks = [
    T({ id: 'a', title: 'a', dueDate: '2026-10-22', projectId: 'p1' }),
    T({ id: 'b', title: 'b', dueDate: '2026-10-22' }),
    T({ id: 'c', title: 'c', dueDate: '2026-10-22', blockedBy: ['b'] }),
    T({ id: 'd', title: 'd', dueDate: '2026-10-22', blockedBy: ['b'] }),
  ];
  const r = rankTasks(tasks, [p], prefs, NOW);
  const byId = Object.fromEntries(r.map((x) => [x.task.id, x]));
  assert.equal(byId.b.score, 30 + 15 + 10); // two tasks wait on b
  assert.equal(byId.a.score, 30 + 15 + 10);
  assert.ok(byId.a.reasons.some((x) => x.key === 'projectBoost'));
  assert.ok(byId.b.reasons.some((x) => x.key === 'blocks' && x.params.count === 2));
  assert.deepEqual(byId.c.waitingOn, ['b']);
  assert.ok(!topTasks(r, 3).some((x) => x.task.id === 'c' || x.task.id === 'd'));
});

test('ranking: tasks without deadlines get the default and stay visible', () => {
  const r = rankTasks([T({ id: 'x', title: 'x' })], [], prefs, NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].score, 8 + 15);
  assert.equal(r[0].reasons[0].key, 'noDeadline');
});

test('ranking: deterministic tie-break (deadline, creation, id) and configurable weights', () => {
  const tasks = [
    T({ id: 'z', title: 'z', dueDate: '2026-10-20', dueTime: '18:00' }),
    T({ id: 'y', title: 'y', dueDate: '2026-10-20', dueTime: '09:00' }),
    T({ id: 'x', title: 'x', dueDate: '2026-10-20', dueTime: '09:00', createdAt: '2026-10-02T00:00:00.000Z' }),
  ];
  assert.deepEqual(rankTasks(tasks, [], prefs, NOW).map((x) => x.task.id), ['y', 'x', 'z']);
  assert.deepEqual(rankTasks([...tasks].reverse(), [], prefs, NOW).map((x) => x.task.id), ['y', 'x', 'z']);
  const custom = { ...prefs, weights: { ...prefs.weights, low: 100 } };
  const r = rankTasks([T({ id: 'l', title: 'l', priority: 'low' }), T({ id: 'h', title: 'h', priority: 'high' })], [], custom, NOW);
  assert.equal(r[0].task.id, 'l');
});

test('ranking: archived project tasks leave the active list', () => {
  const p = makeProject({ id: 'p', name: 'Old', archived: true });
  assert.equal(rankTasks([T({ id: 'a', title: 'a', projectId: 'p' })], [p], prefs, NOW).length, 0);
});

test('fit my day: only counts estimates, never exceeds capacity', () => {
  const tasks = [
    T({ id: 'a', title: 'a', dueDate: '2026-10-16', estimateMin: 90 }),
    T({ id: 'b', title: 'b', dueDate: '2026-10-17', estimateMin: 60 }),
    T({ id: 'c', title: 'c', dueDate: '2026-10-17', estimateMin: 20 }),
    T({ id: 'd', title: 'd', dueDate: '2026-10-18' }),
  ];
  const f = fitDay(rankTasks(tasks, [], prefs, NOW), 120);
  assert.deepEqual(f.fits.map((x) => x.task.id), ['a', 'c']);
  assert.deepEqual(f.tooBig.map((x) => x.task.id), ['b']);
  assert.deepEqual(f.noEstimate.map((x) => x.task.id), ['d']);
  assert.equal(f.used, 110);
  assert.ok(f.used <= f.capacity);
});

test('reminders: relative reminders follow a rescheduled deadline', () => {
  const r = makeReminder({ kind: 'before', minutes: 60 });
  const t1 = T({ dueDate: '2026-10-20', dueTime: '18:00', reminders: [r] });
  assert.equal(D.toLocalISO(reminderTime(t1, r)), '2026-10-20T17:00');
  const t2 = { ...t1, dueDate: '2026-10-22' };
  assert.equal(D.toLocalISO(reminderTime(t2, r)), '2026-10-22T17:00');
  const dateOnly = { ...t1, dueTime: null };
  assert.equal(D.toLocalISO(reminderTime(dateOnly, r)), '2026-10-20T08:00');
});

test('reminders: "1 day before" keeps the wall-clock time across a DST change', () => {
  const r = makeReminder({ kind: 'before', minutes: 1440 });
  const t1 = T({ dueDate: '2026-10-26', dueTime: '09:00', reminders: [r] });
  assert.equal(D.toLocalISO(reminderTime(t1, r)), '2026-10-25T09:00');
  const t2 = T({ dueDate: '2026-11-02', dueTime: '09:00', reminders: [r] });
  assert.equal(D.toLocalISO(reminderTime(t2, r)), '2026-11-01T09:00');
});

test('reminders: fire once, snooze, cancelled when done or deleted', () => {
  const r = makeReminder({ kind: 'at', at: '2026-10-17T09:30' });
  const task = T({ id: 't', title: 't', reminders: [r] });
  const due = dueReminders([task], NOW);
  assert.equal(due.length, 1);
  const fired = { ...task, reminders: [{ ...r, firedFor: due[0].key }] };
  assert.equal(dueReminders([fired], NOW).length, 0, 'not shown twice');
  const snoozed = { ...fired, reminders: [{ ...fired.reminders[0], snoozedUntil: '2026-10-17T10:10' }] };
  assert.equal(dueReminders([snoozed], NOW).length, 0);
  assert.equal(dueReminders([snoozed], new Date(2026, 9, 17, 10, 11)).length, 1, 'shows again after snooze');
  assert.equal(dueReminders([{ ...task, done: true }], NOW).length, 0);
  assert.equal(dueReminders([{ ...task, reminders: [{ ...r, enabled: false }] }], NOW).length, 0);
  // Editing the reminder time makes it a new reminder occurrence.
  const moved = { ...fired, reminders: [{ ...fired.reminders[0], at: '2026-10-17T09:45' }] };
  assert.equal(dueReminders([moved], NOW).length, 1);
  assert.equal(upcomingReminders([T({ reminders: [makeReminder({ kind: 'at', at: '2026-10-18T09:00' })] })], NOW).length, 1);
});

test('stats: counts from stored data only', () => {
  const projects = seedProjects('en', NOW);
  const cs = projects[0];
  const tasks = [
    T({ id: 'a', title: 'a', projectId: cs.id, done: true, completedAt: new Date(2026, 9, 17, 8).toISOString() }),
    T({ id: 'b', title: 'b', projectId: cs.id, done: true, completedAt: new Date(2026, 9, 13, 8).toISOString() }),
    T({ id: 'c', title: 'c', projectId: cs.id, dueDate: '2026-10-16' }),
    T({ id: 'd', title: 'd', dueDate: '2026-10-20', postponeCount: 2 }),
    T({ id: 'e', title: 'e', done: true, completedAt: new Date(2026, 9, 10, 8).toISOString() }),
    { id: 'x', deleted: true, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
  ];
  const ov = overview(tasks, projects, prefs, NOW);
  assert.equal(ov.doneToday, 1);
  assert.equal(ov.doneWeek, 2); // week starts Monday 12/10
  assert.equal(ov.open, 2);
  assert.equal(ov.overdue, 1);
  assert.equal(ov.upcoming7, 1);
  assert.equal(ov.postponed.length, 1);
  const s = projectStats(cs, tasks, NOW);
  assert.deepEqual([s.total, s.done, s.open, s.percent], [3, 2, 1, 67]);
  assert.ok(behindReasons(cs, s, NOW).some((r) => r.key === 'projOverdue'));
  const fresh = makeProject({ id: 'f', name: 'f' });
  const s2 = projectStats(fresh, [T({ title: 'n', projectId: 'f', createdAt: new Date(2026, 9, 16).toISOString() })], NOW);
  assert.equal(behindReasons(fresh, s2, NOW).length, 0, 'new project not flagged');
});

test('calendar export: ics and Google Calendar link', () => {
  const task = T({ id: 'task_1', title: 'Case, final', dueDate: '2026-10-20', dueTime: '18:00', reminders: [makeReminder({ minutes: 60 })] });
  const ics = buildICS(task, { now: NOW });
  assert.match(ics, /DTSTART:20261020T180000/);
  assert.match(ics, /SUMMARY:Case\\, final/);
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.match(googleCalendarUrl(task), /dates=20261020T180000%2F20261020T183000/);
  const allDay = buildICS({ ...task, dueTime: null }, { now: NOW });
  assert.match(allDay, /DTSTART;VALUE=DATE:20261020/);
  assert.match(allDay, /TRIGGER:PT480M/); // 60 min before 09:00 = 08:00 = 480 min after midnight
  assert.equal(buildICS(T({}), { now: NOW }), null);
});
