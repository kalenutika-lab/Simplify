// Unit tests for quick-add parsing, import validation, sync merge, encryption and sync rounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseQuickAdd } from '../../app/js/core/parse.js';
import { planImport, buildExport, validateTask, validateProject, validatePrefs } from '../../app/js/core/validate.js';
import { mergeRecords, mergePrefs } from '../../app/js/core/merge.js';
import { encryptJSON, decryptJSON } from '../../app/js/core/crypto.js';
import { syncOnce, SYNC_FILE } from '../../app/js/core/sync.js';
import { makePairCode, readPairCode, pairLink, extractPairCode } from '../../app/js/core/pair.js';
import qrcode from '../../app/js/vendor/qrcode.js';
import { makeTask, seedProjects, defaultPrefs } from '../../app/js/core/model.js';

const NOW = new Date(2026, 9, 17, 10, 0); // Saturday
const projects = seedProjects('en', NOW);

test('quick-add: the example from the brief', () => {
  const p = parseQuickAdd('Finish the market-sizing case tomorrow by 18:00, high priority, 90 minutes.', { now: NOW, projects });
  assert.equal(p.title, 'Finish the market-sizing case');
  assert.equal(p.dueDate, '2026-10-18');
  assert.equal(p.dueTime, '18:00');
  assert.equal(p.priority, 'high');
  assert.equal(p.estimateMin, 90);
  assert.equal(p.ambiguities.length, 0);
});

test('quick-add: French phrases', () => {
  const p = parseQuickAdd('Réviser le 5 novembre à 14h30 priorité haute obligatoire', { now: NOW, projects });
  assert.deepEqual([p.title, p.dueDate, p.dueTime, p.priority, p.mandatory], ['Réviser', '2026-11-05', '14:30', 'high', true]);
  const q = parseQuickAdd('Relancer Paul demain 9h urgent', { now: NOW, projects });
  assert.deepEqual([q.title, q.dueDate, q.dueTime, q.priority], ['Relancer Paul', '2026-10-18', '09:00', 'high']);
  const r = parseQuickAdd('Préparer entretien après-demain pendant 2 heures', { now: NOW, projects });
  assert.deepEqual([r.dueDate, r.estimateMin], ['2026-10-19', 120]);
});

test('quick-add: projects, weekdays and dates', () => {
  const p = parseQuickAdd('Essay #skema friday 2h30 min', { now: NOW, projects });
  assert.equal(p.projectId, 'proj_default_skema');
  assert.equal(p.dueDate, '2026-10-23');
  assert.equal(p.estimateMin, 150);
  assert.equal(parseQuickAdd('Call Sam', { now: NOW }).dueDate, null, 'names are not weekdays');
  assert.equal(parseQuickAdd('Report 5/11', { now: NOW }).dueDate, '2026-11-05', 'DD/MM');
  assert.equal(parseQuickAdd('Report 2026-11-05', { now: NOW }).dueDate, '2026-11-05');
  assert.equal(parseQuickAdd('Report in 3 days', { now: NOW }).dueDate, '2026-10-20');
  assert.equal(parseQuickAdd('Plan nov 5', { now: NOW }).dueDate, '2026-11-05');
});

test('quick-add: ambiguous or invalid dates are not guessed', () => {
  const same = parseQuickAdd('Send CV saturday', { now: NOW });
  assert.equal(same.dueDate, null);
  assert.deepEqual(same.ambiguities[0].options, ['2026-10-17', '2026-10-24']);
  const vague = parseQuickAdd('Prep next week', { now: NOW });
  assert.equal(vague.dueDate, null);
  assert.equal(vague.ambiguities[0].reason, 'vague');
  const past = parseQuickAdd('Meeting 3/2', { now: NOW });
  assert.equal(past.dueDate, null);
  assert.deepEqual(past.ambiguities[0].options, ['2026-02-03', '2027-02-03']);
  const bad = parseQuickAdd('Draft 31/02', { now: NOW });
  assert.equal(bad.dueDate, null);
  assert.equal(bad.ambiguities[0].reason, 'invalidDate');
  const passed = parseQuickAdd('Lunch at 09:00', { now: NOW });
  assert.equal(passed.dueDate, null);
  assert.equal(passed.ambiguities[0].reason, 'timeOnly');
  assert.equal(parseQuickAdd('Unknown #nope', { now: NOW, projects }).ambiguities[0].reason, 'unknownProject');
});

test('quick-add: a plain title is left alone', () => {
  const p = parseQuickAdd('Buy milk', { now: NOW });
  assert.equal(p.title, 'Buy milk');
  assert.equal(p.recognized.length + p.ambiguities.length, 0);
});

const ts = '2026-10-10T10:00:00.000Z';
const goodTask = (f = {}) => ({ id: 'task_a', title: 'A', createdAt: ts, updatedAt: ts, ...f });

test('import: valid, invalid and duplicate records are reported', () => {
  const file = JSON.stringify({
    app: 'personal-project-manager', schema: 1,
    projects: [{ id: 'proj_x', name: 'X', createdAt: ts, updatedAt: ts }, { id: 'proj_bad', name: '', createdAt: ts, updatedAt: ts }],
    tasks: [
      goodTask(),
      goodTask(),
      goodTask({ id: 'task_b', title: '' }),
      goodTask({ id: 'task_c', dueDate: '2026-02-30' }),
      goodTask({ id: 'task_d', priority: 'urgent' }),
      goodTask({ id: 'task_e', projectId: 'proj_missing' }),
      'nonsense',
      goodTask({ id: 'task_f', dueTime: '18:00' }),
    ],
  });
  const plan = planImport(file, { tasks: [], projects: [] }, 'merge', defaultPrefs());
  assert.equal(plan.report.added, 3); // proj_x, task_a, task_e
  const reasons = plan.report.rejected.map((r) => r.reason).sort();
  assert.deepEqual(reasons, ['badDate', 'badPriority', 'duplicateInFile', 'noName', 'noTitle', 'notObject', 'timeWithoutDate']);
  assert.equal(plan.tasks.find((t) => t.id === 'task_e').projectId, null);
  assert.equal(plan.report.warnings.length, 1);
});

test('import: re-importing the same backup creates no duplicates; newer wins', () => {
  const state = { tasks: [makeTask({ id: 'task_1', title: 'One', createdAt: ts, updatedAt: ts })], projects: projects };
  const file = JSON.stringify(buildExport({ ...state, prefs: defaultPrefs() }));
  const again = planImport(file, state, 'merge', defaultPrefs());
  assert.equal(again.report.added, 0);
  assert.equal(again.tasks.length, 1);
  assert.equal(again.report.unchanged, 1 + projects.length);
  const newer = JSON.parse(file);
  newer.tasks[0].title = 'One (edited)';
  newer.tasks[0].updatedAt = '2026-10-11T00:00:00.000Z';
  const older = JSON.parse(file);
  older.tasks[0].title = 'Old';
  older.tasks[0].updatedAt = '2026-10-01T00:00:00.000Z';
  assert.equal(planImport(JSON.stringify(newer), state, 'merge', defaultPrefs()).tasks[0].title, 'One (edited)');
  const p2 = planImport(JSON.stringify(older), state, 'merge', defaultPrefs());
  assert.equal(p2.tasks[0].title, 'One');
  assert.equal(p2.report.keptLocal, 1);
  assert.equal(planImport(file, state, 'replace', defaultPrefs()).report.added, 1 + projects.length);
});

test('import: corrupted or foreign files change nothing', () => {
  assert.equal(planImport('{not json', { tasks: [], projects: [] }).error, 'notJson');
  assert.equal(planImport('{"hello":1}', { tasks: [], projects: [] }).error, 'notOurFile');
  assert.equal(planImport('{"app":"personal-project-manager","schema":99,"tasks":[],"projects":[]}', { tasks: [], projects: [] }).error, 'newerSchema');
  assert.equal(planImport('{"app":"personal-project-manager","schema":1}', { tasks: [], projects: [] }).error, 'missingLists');
});

test('validation: tombstones, prefs and limits', () => {
  assert.equal(validateTask({ id: 'task_z', deleted: true, createdAt: ts, updatedAt: ts }).ok, true);
  assert.equal(validateTask(goodTask({ id: '../etc' })).ok, false);
  assert.equal(validateTask(goodTask({ estimateMin: -5 })).ok, false);
  assert.equal(validateTask(goodTask({ reminders: [{ id: 'r1', kind: 'at', at: 'tomorrow' }] })).ok, false);
  assert.equal(validateProject({ id: 'p', name: 'P', boost: 1000, createdAt: ts, updatedAt: ts }).ok, false);
  const p = validatePrefs({ weekStart: 7, focusWeekday: 300, weights: { high: 'x', low: 5 } }, defaultPrefs());
  assert.equal(p.weekStart, 1);
  assert.equal(p.focusWeekday, 300);
  assert.equal(p.weights.high, 30);
  assert.equal(p.weights.low, 5);
});

test('merge: newest edit wins, deletions propagate, both sides converge', () => {
  const a = makeTask({ id: 't1', title: 'A-old', updatedAt: '2026-10-10T00:00:00.000Z' });
  const a2 = { ...a, title: 'A-new', updatedAt: '2026-10-11T00:00:00.000Z' };
  const b = makeTask({ id: 't2', title: 'B', updatedAt: '2026-10-10T00:00:00.000Z' });
  const bDel = { id: 't2', deleted: true, createdAt: b.createdAt, updatedAt: '2026-10-12T00:00:00.000Z' };
  const c = makeTask({ id: 't3', title: 'C only remote' });
  const local = [a2, b];
  const remote = [a, bDel, c];
  const m1 = mergeRecords(local, remote);
  const m2 = mergeRecords(remote, local);
  assert.deepEqual(m1.merged, m2.merged);
  assert.equal(m1.merged.find((x) => x.id === 't1').title, 'A-new');
  assert.equal(m1.merged.find((x) => x.id === 't2').deleted, true);
  assert.equal(m1.localChanged, true);
  assert.equal(m1.remoteChanged, true);
  const same = mergeRecords(m1.merged, m1.merged);
  assert.equal(same.localChanged || same.remoteChanged, false);
  const pr = mergePrefs({ ...defaultPrefs(), updatedAt: '2026-10-12T00:00:00.000Z' }, defaultPrefs());
  assert.equal(pr.remoteChanged, true);
});

test('encryption: round trip, wrong passphrase rejected, no plain text', async () => {
  const box = await encryptJSON({ secret: 'Finish McKinsey case' }, 'correct horse');
  assert.ok(!box.includes('McKinsey'));
  assert.deepEqual(await decryptJSON(box, 'correct horse'), { secret: 'Finish McKinsey case' });
  await assert.rejects(decryptJSON(box, 'wrong horse!'), /wrongPassphrase/);
  await assert.rejects(decryptJSON('{"x":1}', 'whatever1'), /notEncrypted/);
});

// --- Fake GitHub Gist API ---
function fakeGitHub({ token = 'tok' } = {}) {
  const gists = new Map();
  let n = 0;
  const calls = [];
  const res = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
  const view = (id) => {
    const g = gists.get(id);
    return { id, updated_at: g.updated, history: [{ version: `v${g.version}` }], files: { [SYNC_FILE]: { content: g.content, truncated: false } } };
  };
  const fetchFn = async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url.replace('https://api.github.com', '')}`);
    if (opts.headers.Authorization !== `Bearer ${token}`) return res(401, {});
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (u.pathname === '/gists' && opts.method === 'GET') return res(200, [...gists.keys()].map((id) => ({ id, files: { [SYNC_FILE]: {} } })));
    if (u.pathname === '/gists' && opts.method === 'POST') {
      const id = `g${++n}`;
      assert.equal(body.public, false, 'gist must be secret');
      gists.set(id, { content: body.files[SYNC_FILE].content, version: 1, updated: new Date().toISOString() });
      return res(201, view(id));
    }
    const m = u.pathname.match(/^\/gists\/(.+)$/);
    if (m && gists.has(m[1])) {
      if (opts.method === 'PATCH') {
        const g = gists.get(m[1]);
        g.content = body.files[SYNC_FILE].content;
        g.version++;
      }
      return res(200, view(m[1]));
    }
    return res(404, {});
  };
  return { fetchFn, gists, calls };
}

const validate = (raw) => ({
  tasks: raw.tasks.map(validateTask).filter((r) => r.ok).map((r) => r.value),
  projects: raw.projects.map(validateProject).filter((r) => r.ok).map((r) => r.value),
  prefs: raw.prefs ? validatePrefs(raw.prefs, defaultPrefs()) : null,
  rejected: 0,
});

test('sync: two devices converge through an encrypted secret gist', async () => {
  const gh = fakeGitHub();
  const opts = { token: 'tok', passphrase: 'my long passphrase', fetchFn: gh.fetchFn, validate };
  const phone = { tasks: [makeTask({ id: 'task_p', title: 'From phone' })], projects, prefs: defaultPrefs() };
  const r1 = await syncOnce(phone, { ...opts, gistId: '' });
  assert.ok(r1.created);
  assert.ok(!gh.gists.get(r1.gistId).content.includes('From phone'), 'stored encrypted');

  const laptop = { tasks: [makeTask({ id: 'task_l', title: 'From laptop' })], projects, prefs: defaultPrefs() };
  const r2 = await syncOnce(laptop, { ...opts, gistId: '' });
  assert.equal(r2.gistId, r1.gistId, 'second device finds the same gist');
  assert.deepEqual(r2.state.tasks.map((t) => t.title).sort(), ['From laptop', 'From phone']);
  assert.ok(r2.pushed);

  const r3 = await syncOnce(phone, { ...opts, gistId: r1.gistId });
  assert.deepEqual(r3.state.tasks.map((t) => t.title).sort(), ['From laptop', 'From phone']);
  assert.equal(r3.pushed, false, 'nothing new to upload');
});

test('sync: wrong passphrase or bad token never overwrites the remote copy', async () => {
  const gh = fakeGitHub();
  const base = { token: 'tok', fetchFn: gh.fetchFn, validate };
  const r = await syncOnce({ tasks: [], projects, prefs: defaultPrefs() }, { ...base, passphrase: 'passphrase one', gistId: '' });
  const before = gh.gists.get(r.gistId).content;
  await assert.rejects(syncOnce({ tasks: [makeTask({ title: 'x' })], projects, prefs: defaultPrefs() }, { ...base, passphrase: 'passphrase two', gistId: r.gistId }), (e) => e.code === 'wrongPassphrase');
  assert.equal(gh.gists.get(r.gistId).content, before);
  await assert.rejects(syncOnce({ tasks: [], projects, prefs: defaultPrefs() }, { ...base, token: 'bad', passphrase: 'passphrase one', gistId: r.gistId }), (e) => e.code === 'badToken');
  await assert.rejects(syncOnce({ tasks: [], projects, prefs: defaultPrefs() }, { ...base, passphrase: 'short', gistId: '' }), (e) => e.code === 'shortPassphrase');
});

test('sync: offline is reported, not thrown away', async () => {
  const fetchFn = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(syncOnce({ tasks: [], projects, prefs: defaultPrefs() }, { token: 't', passphrase: 'long enough', fetchFn, validate }), (e) => e.code === 'offline');
});

// --- App consistency checks ---
const appDir = new URL('../../app/', import.meta.url).pathname;

test('i18n: English and French have the same keys, and every key used exists', async () => {
  globalThis.navigator ??= { language: 'en' };
  const { DICTS } = await import('../../app/js/i18n.js');
  assert.deepEqual(Object.keys(DICTS.fr).sort(), Object.keys(DICTS.en).sort());
  const used = new Set();
  const walk = (d) => readdirSync(d).forEach((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== 'vendor') walk(p); return; }
    if (!p.endsWith('.js')) return;
    for (const m of readFileSync(p, 'utf8').matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  });
  walk(join(appDir, 'js'));
  const missing = [...used].filter((k) => !(k in DICTS.en));
  assert.deepEqual(missing, []);
});

test('service worker caches every app file', () => {
  const sw = readFileSync(join(appDir, 'sw.js'), 'utf8');
  const files = [];
  const walk = (d) => readdirSync(d).forEach((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) return walk(p);
    files.push(relative(appDir, p));
  });
  walk(appDir);
  const needed = files.filter((f) => /\.(js|css|html|webmanifest|png|svg)$/.test(f) && f !== 'sw.js' && f !== 'icons/maskable.svg');
  const missing = needed.filter((f) => !sw.includes(`'./${f}'`));
  assert.deepEqual(missing, []);
});

test('pairing link: carries the token encrypted, needs the passphrase, fits in a QR code', async () => {
  const token = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab';
  const code = await makePairCode(token, 'correct horse');
  assert.ok(!code.includes('github_pat'), 'token must not appear in clear');
  const link = pairLink('https://kalenutika-lab.github.io/Simplify/#settings', code);
  assert.equal(link, `https://kalenutika-lab.github.io/Simplify/#pair=${code}`);
  assert.equal(extractPairCode(link), code);
  assert.equal(extractPairCode(`#pair=${code}`), code);
  assert.equal(extractPairCode('hello'), null);
  assert.equal(await readPairCode(code, 'correct horse'), token);
  await assert.rejects(readPairCode(code, 'wrong horse'), /wrongPassphrase/);
  await assert.rejects(readPairCode('A'.repeat(60), 'correct horse'), /badPairCode/);
  const qr = qrcode(0, 'L');
  qr.addData(link);
  qr.make();
  assert.ok(qr.getModuleCount() <= 117, 'QR code stays scannable on a phone screen');
});
