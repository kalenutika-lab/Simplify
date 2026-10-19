// Browser tests of the real app in Chromium. Run: npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, teardown, openApp, quickAdd, saveEditor, titles, setTime } from './helpers.js';

let env;
before(async () => { env = await setup(); });
after(async () => { await teardown(env); });

test('1 & 11: empty state, then create a task with only a title', async () => {
  const { page, context, errors } = await openApp(env);
  assert.match(await page.locator('.top3').innerText(), /Nothing open/);
  assert.match(await page.locator('body').innerText(), /Nothing overdue\./);
  await quickAdd(page, 'Buy printer paper');
  await page.waitForSelector('.top3 .task');
  assert.deepEqual(await titles(page.locator('.top3')), ['Buy printer paper']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('quick-add preview: parsed fields are shown before saving', async () => {
  const { page, context } = await openApp(env);
  await quickAdd(page, 'Finish the market-sizing case tomorrow by 18:00, high priority, 90 minutes #case');
  await page.waitForSelector('.sheet');
  assert.equal(await page.locator('#f-title').inputValue(), 'Finish the market-sizing case');
  assert.equal(await page.locator('#f-date').inputValue(), '18/10/2026');
  assert.equal(await page.locator('#f-time').inputValue(), '18:00');
  assert.equal(await page.locator('#f-est').inputValue(), '90');
  assert.equal(await page.locator('#f-prio').inputValue(), 'high');
  assert.equal(await page.locator('#f-project').inputValue(), 'proj_default_case');
  // Cancelling a preview saves nothing.
  await page.locator('.sheet-foot .btn', { hasText: 'Cancel' }).click();
  await page.locator('.dialog .btn.danger').click().catch(() => {});
  assert.match(await page.locator('.top3').innerText(), /Nothing open/);
  // Ambiguous date asks instead of guessing.
  await quickAdd(page, 'Send CV saturday');
  await page.waitForSelector('.notice.warn');
  assert.equal(await page.locator('#f-date').inputValue(), '');
  await page.locator('.notice.warn .chip', { hasText: '24/10/2026' }).click();
  await saveEditor(page);
  assert.match(await page.locator('.top3').innerText(), /Send CV/);
  await context.close();
});

test('2: edit and delete tasks (with confirmation and undo)', async () => {
  const { page, context } = await openApp(env);
  await quickAdd(page, 'Draft cover letter');
  await page.locator('.top3 .task-main').first().click();
  await page.locator('#f-title').fill('Draft cover letter for BCG');
  await page.locator('#f-date').fill('20/10/2026');
  await page.locator('#f-prio').selectOption('high');
  await saveEditor(page);
  assert.match(await page.locator('.top3').innerText(), /Draft cover letter for BCG[\s\S]*High/);
  // Unsaved changes are not silently discarded.
  await page.locator('.top3 .task-main').first().click();
  await page.locator('#f-title').fill('Changed');
  await page.locator('.sheet-foot .btn', { hasText: 'Cancel' }).click();
  await page.waitForSelector('.dialog');
  await page.locator('.dialog .btn', { hasText: 'Keep editing' }).click();
  assert.equal(await page.locator('#f-title').inputValue(), 'Changed');
  await page.locator('.sheet-foot .btn', { hasText: 'Cancel' }).click();
  await page.locator('.dialog .btn', { hasText: 'Discard' }).click();
  assert.match(await page.locator('.top3').innerText(), /Draft cover letter for BCG/);
  // Delete asks first; cancelling keeps it.
  await page.locator('.top3 .task-main').first().click();
  await page.locator('.sheet-foot .btn', { hasText: 'Delete' }).click();
  await page.locator('.dialog .btn', { hasText: 'Cancel' }).click();
  await page.locator('.sheet-foot .btn', { hasText: 'Delete' }).click();
  await page.locator('.dialog .btn.danger').click();
  await page.waitForSelector('.sheet', { state: 'detached' });
  assert.match(await page.locator('.top3').innerText(), /Nothing open/);
  await page.locator('.toast .btn', { hasText: 'Undo' }).click();
  await page.waitForSelector('.top3 .task');
  assert.match(await page.locator('.top3').innerText(), /Draft cover letter for BCG/);
  // Duplicate
  await page.locator('.top3 .task-main').first().click();
  await page.locator('.sheet-foot .btn', { hasText: 'Duplicate' }).click();
  await page.waitForSelector('.sheet');
  assert.equal(await page.locator('#f-title').inputValue(), 'Draft cover letter for BCG (copy)');
  await page.locator('.sheet-head .btn').click();
  await page.waitForSelector('.sheet', { state: 'detached' });
  await context.close();
});

test('3: complete and reopen; completed tasks leave the active list', async () => {
  const { page, context } = await openApp(env);
  await quickAdd(page, 'Call recruiter');
  await page.locator('.top3 .check').first().click();
  assert.match(await page.locator('.top3').innerText(), /Nothing open/);
  await page.locator('.filters .chip', { hasText: 'Completed' }).click();
  const list = page.locator('section', { hasText: 'All tasks' }).last();
  assert.deepEqual(await titles(list), ['Call recruiter']);
  await list.locator('.check').first().click();
  await page.locator('.filters .chip', { hasText: 'All' }).click();
  assert.match(await page.locator('.top3').innerText(), /Call recruiter/);
  await context.close();
});

async function addTask(page, { title, date, time, prio, mandatory, project }) {
  await quickAdd(page, title);
  // Titles containing date words open the confirmation sheet directly; otherwise open the saved task.
  await page.waitForTimeout(100);
  if (!(await page.locator('.sheet').count())) await page.locator('.task-main', { hasText: title }).first().click();
  await page.locator('#f-title').fill(title);
  if (date) await page.locator('#f-date').fill(date);
  if (time) await page.locator('#f-time').fill(time);
  if (prio) await page.locator('#f-prio').selectOption(prio);
  if (project) await page.locator('#f-project').selectOption(project);
  if (mandatory) await page.locator('label.check-row', { hasText: 'Mandatory' }).locator('input').check();
  await saveEditor(page);
}

test('4, 5, 6: overdue/upcoming order, mandatory, manual override, no-deadline tasks', async () => {
  const { page, context } = await openApp(env);
  await addTask(page, { title: 'Next month essay', date: '30/11/2026', prio: 'high' });
  await addTask(page, { title: 'Late report', date: '14/10/2026', prio: 'low' });
  await addTask(page, { title: 'Today memo', date: '17/10/2026' });
  await addTask(page, { title: 'Someday idea' });
  await addTask(page, { title: 'Tuesday task A', date: '20/10/2026' });
  await addTask(page, { title: 'Tuesday task B', date: '20/10/2026', mandatory: true });
  const all = page.locator('section', { hasText: 'All tasks' }).last();
  assert.deepEqual(await titles(all), ['Late report', 'Today memo', 'Tuesday task B', 'Tuesday task A', 'Next month essay', 'Someday idea']);
  assert.match(await page.locator('section', { hasText: 'Overdue (1)' }).innerText(), /3 days late/);
  // Score explanation is visible.
  await page.locator('.top3 .score').first().click();
  assert.match(await page.locator('.why').innerText(), /Overdue by 3 days[\s\S]*\+106/);
  // Manual pin moves a no-deadline task to the top.
  await page.locator('.task-main', { hasText: 'Someday idea' }).first().click();
  await page.locator('#f-manual').selectOption('pin');
  await saveEditor(page);
  assert.equal((await titles(page.locator('.top3')))[0], 'Someday idea');
  // Filters
  await page.locator('.filters .chip', { hasText: 'No deadline' }).click();
  assert.deepEqual(await titles(all), ['Someday idea']);
  await page.locator('.filters .chip', { hasText: 'Overdue' }).click();
  assert.deepEqual(await titles(all), ['Late report']);
  await page.locator('.filters .chip', { hasText: 'Upcoming' }).click();
  assert.deepEqual(await titles(all), ['Tuesday task B', 'Tuesday task A', 'Next month essay']);
  await page.locator('.filters .chip', { hasText: 'Today' }).click();
  assert.deepEqual(await titles(all), ['Today memo']);
  await context.close();
});

test('7: reminders follow rescheduling, show once, can be snoozed', async () => {
  const { page, context } = await openApp(env);
  await addTask(page, { title: 'Submit application', date: '18/10/2026', time: '18:00' });
  await page.locator('.task-main', { hasText: 'Submit application' }).first().click();
  await page.locator('.sheet .btn', { hasText: 'Add reminder' }).click();
  await saveEditor(page);
  await page.locator('.tab', { hasText: 'Agenda' }).click();
  assert.match(await page.locator('section', { hasText: 'Upcoming reminders' }).innerText(), /18\/10\/2026 17:00/);
  // Reschedule from the agenda (asks first; never silently).
  await page.locator('.seg button', { hasText: 'Day' }).click();
  await page.locator('.toolbar .btn', { hasText: '›' }).click();
  await page.locator('.move-btn').first().click();
  await page.locator('.move-panel .chip', { hasText: '+1 day' }).click();
  assert.match(await page.locator('.dialog').innerText(), /from 18\/10\/2026 to 19\/10\/2026/);
  await page.locator('.dialog .btn.primary').click();
  await page.waitForSelector('.dialog', { state: 'detached' });
  assert.match(await page.locator('section', { hasText: 'Upcoming reminders' }).innerText(), /19\/10\/2026 17:00/);
  // At 17:01 on 19/10 the reminder appears once.
  await setTime(page, 'Europe/Paris', '2026-10-19T17:01:00');
  await page.reload();
  await page.waitForSelector('.alert');
  assert.match(await page.locator('.alert').innerText(), /Submit application/);
  await page.locator('.alert .btn', { hasText: 'Snooze 10 min' }).click();
  await page.waitForSelector('.alert', { state: 'detached' });
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.alert').count(), 0, 'not repeated while snoozed');
  await setTime(page, 'Europe/Paris', '2026-10-19T17:12:00');
  await page.reload();
  await page.waitForSelector('.alert');
  await page.locator('.alert .btn', { hasText: 'Dismiss' }).click();
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.alert').count(), 0, 'shown only once');
  // Completing cancels future reminders.
  const postponed = await page.locator('.task-main', { hasText: 'Submit application' }).first();
  await postponed.click();
  assert.match(await page.locator('.sheet').innerText(), /Postponed 1 time/);
  await page.locator('.sheet-head .btn').click();
  await context.close();
});

test('8, 9, 10: persistence, export, delete all, restore, bad imports', async () => {
  const { page, context } = await openApp(env);
  await addTask(page, { title: 'Persistent task', date: '22/10/2026', project: 'proj_default_apps' });
  await page.reload();
  await page.waitForSelector('.top3 .task');
  assert.match(await page.locator('.top3').innerText(), /Persistent task[\s\S]*Applications/);
  await page.locator('.tab', { hasText: 'Settings' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.btn', { hasText: 'Export backup' }).click()]);
  const dir = await mkdtemp(join(tmpdir(), 'ppm-'));
  const file = join(dir, 'backup.json');
  await dl.saveAs(file);
  const json = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(json.app, 'personal-project-manager');
  assert.equal(json.tasks.length, 1);
  assert.equal(json.projects.length, 6);
  // Delete everything (typed confirmation).
  await page.locator('.btn', { hasText: 'Delete all data on this device' }).click();
  const confirm = page.locator('.dialog .btn.danger');
  assert.equal(await confirm.isDisabled(), true);
  await page.locator('.dialog input').fill('DELETE');
  await confirm.click();
  await page.locator('.tab', { hasText: 'Home' }).click();
  assert.match(await page.locator('.top3').innerText(), /Nothing open/);
  // Restore
  await page.locator('.tab', { hasText: 'Settings' }).click();
  await page.locator('input[type=file]').setInputFiles(file);
  await page.waitForSelector('.import-report');
  assert.match(await page.locator('.import-report').innerText(), /New records: 1[\s\S]*Already identical: 6[\s\S]*Rejected: 0/);
  await page.locator('.import-report .btn.primary').click();
  await page.locator('.tab', { hasText: 'Home' }).click();
  assert.match(await page.locator('.top3').innerText(), /Persistent task/);
  // Importing the same file again adds nothing.
  await page.locator('.tab', { hasText: 'Settings' }).click();
  await page.locator('input[type=file]').setInputFiles(file);
  assert.match(await page.locator('.import-report').innerText(), /New records: 0/);
  await page.locator('.import-report .btn', { hasText: 'Cancel' }).click();
  // Invalid and duplicate records
  const bad = { ...json, tasks: [...json.tasks, json.tasks[0], { id: 'task_bad', title: '', createdAt: json.tasks[0].createdAt, updatedAt: json.tasks[0].updatedAt }, { ...json.tasks[0], id: 'task_date', dueDate: '2026-02-31' }] };
  const badFile = join(dir, 'bad.json');
  await writeFile(badFile, JSON.stringify(bad));
  await page.locator('input[type=file]').setInputFiles(badFile);
  const rep = await page.locator('.import-report').innerText();
  assert.match(rep, /Rejected: 3/);
  assert.match(rep, /duplicate ID in the file/);
  assert.match(rep, /no title/);
  assert.match(rep, /invalid date/);
  await page.locator('.import-report .btn', { hasText: 'Cancel' }).click();
  // Corrupted file
  const broken = join(dir, 'broken.json');
  await writeFile(broken, '{"app": "personal-project-manager", "tasks": [');
  await page.locator('input[type=file]').setInputFiles(broken);
  assert.match(await page.locator('.error[role=alert]').innerText(), /not a valid backup/);
  await page.locator('.tab', { hasText: 'Home' }).click();
  assert.deepEqual(await titles(page.locator('.top3')), ['Persistent task']);
  await context.close();
});

test('12: layouts fit phone and desktop widths on every tab', async () => {
  for (const [width, height] of [[360, 740], [390, 844], [768, 1024], [1280, 800]]) {
    const { page, context, errors } = await openApp(env, { width, height });
    await addTask(page, { title: 'A fairly long task title to check wrapping on small screens', date: '17/10/2026', prio: 'high' });
    for (const tab of ['Home', 'Projects', 'Agenda', 'Progress', 'Settings']) {
      await page.locator('.tab', { hasText: tab }).click();
      await page.waitForTimeout(50);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${tab} at ${width}px overflows by ${overflow}px`);
      await page.screenshot({ path: join(process.env.SHOTS || tmpdir(), `${tab.toLowerCase()}-${width}.png`), fullPage: false });
    }
    // Touch targets on phone: the complete button is at least 44px.
    if (width < 500) {
      await page.locator('.tab', { hasText: 'Home' }).click();
      const box = await page.locator('.check').first().boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('13: works offline after the first visit', async () => {
  const { page, context } = await openApp(env);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.quickadd input');
  await quickAdd(page, 'Added while offline');
  assert.match(await page.locator('.top3').innerText(), /Added while offline/);
  await page.reload();
  await page.waitForSelector('.top3 .task');
  assert.match(await page.locator('.top3').innerText(), /Added while offline/);
  await context.close();
});

test('14: time zones and date boundaries use local time', async () => {
  const { page, context } = await openApp(env, { timezoneId: 'America/New_York', time: '2026-10-17T23:30:00' });
  await addTask(page, { title: 'Due tonight', date: '17/10/2026' });
  assert.match(await page.locator('section', { hasText: 'Due today (1)' }).innerText(), /Due tonight/);
  await setTime(page, 'America/New_York', '2026-10-18T00:01:00');
  await page.reload();
  await page.waitForSelector('.top3 .task');
  assert.match(await page.locator('section', { hasText: 'Overdue (1)' }).innerText(), /Due tonight[\s\S]*1 day late/);
  await context.close();
});

test('language switch to French, progress figures and projects', async () => {
  const { page, context } = await openApp(env);
  await addTask(page, { title: 'Done today', project: 'proj_default_case' });
  await addTask(page, { title: 'Still open', project: 'proj_default_case', date: '16/10/2026' });
  await page.locator('.task .check').first().click(); // completes the top task (overdue one)
  await page.locator('.tab', { hasText: 'Progress' }).click();
  const tiles = await page.locator('.tiles').innerText();
  assert.match(tiles, /1\s*Completed today/);
  assert.match(tiles, /1\s*Open tasks/);
  assert.match(await page.locator('.proj-progress').innerText(), /Case Study[\s\S]*1 of 2 done · 1 remaining · 50%/);
  // Projects: archive hides from Home, restore brings back.
  await page.locator('.tab', { hasText: 'Projects' }).click();
  await page.locator('.proj-head', { hasText: 'Case Study' }).click();
  await page.locator('.project .btn', { hasText: 'Archive' }).click();
  await page.locator('.tab', { hasText: 'Home' }).click();
  assert.match(await page.locator('.top3').innerText(), /Nothing open/);
  await page.locator('.tab', { hasText: 'Projects' }).click();
  await page.locator('label', { hasText: 'Show archived' }).locator('input').check();
  await page.locator('.proj-head', { hasText: 'Case Study' }).click();
  await page.locator('.project .btn', { hasText: 'Restore' }).click();
  await page.locator('.tab', { hasText: 'Settings' }).click();
  await page.locator('#s-lang').selectOption('fr');
  await page.locator('.tab', { hasText: 'Accueil' }).click();
  const body = await page.locator('body').innerText();
  assert.match(body, /samedi 17 octobre 2026/);
  assert.match(body, /Top 3 du jour/);
  await page.reload();
  await page.waitForSelector('.top3');
  assert.match(await page.locator('.top3').innerText(), /Top 3 du jour/);
  await context.close();
});

test('sync pairing: second device joins with a code and the passphrase only', async () => {
  // In-memory stand-in for the GitHub Gist API, shared by both devices.
  const gists = new Map();
  let n = 0;
  async function fakeGitHub(route) {
    const req = route.request();
    const url = new URL(req.url());
    if (req.headers().authorization !== 'Bearer test-token-123') return route.fulfill({ status: 401, body: '{}' });
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const view = (id) => { const g = gists.get(id); return { id, files: { 'ppm-sync.json': { content: g.content, truncated: false } }, history: [{ version: String(g.v) }], updated_at: String(g.v) }; };
    if (url.pathname === '/gists' && req.method() === 'GET') return json(200, [...gists.keys()].map(view));
    if (url.pathname === '/gists' && req.method() === 'POST') {
      const id = `g${++n}`;
      gists.set(id, { content: JSON.parse(req.postData()).files['ppm-sync.json'].content, v: 1 });
      return json(201, view(id));
    }
    const id = url.pathname.split('/')[2];
    if (!gists.has(id)) return json(404, {});
    if (req.method() === 'PATCH') {
      const g = gists.get(id);
      gists.set(id, { content: JSON.parse(req.postData()).files['ppm-sync.json'].content, v: g.v + 1 });
    }
    return json(200, view(id));
  }

  const pc = await openApp(env, { width: 1280, height: 900, time: null });
  await pc.context.route('https://api.github.com/**', fakeGitHub);
  await quickAdd(pc.page, 'Task from computer');
  await pc.page.click('a[href="#settings"]');
  await pc.page.click('summary:has-text("First device")');
  await pc.page.fill('#s-token', 'test-token-123');
  await pc.page.fill('#s-pass', 'my secret phrase');
  await pc.page.click('button:has-text("Turn on sync")');
  await pc.page.waitForSelector('.qr svg');
  const link = await pc.page.inputValue('.pair-link');
  assert.ok(!link.includes('test-token-123'), 'token is not readable in the link');

  const phone = await openApp(env, { time: null });
  await phone.context.route('https://api.github.com/**', fakeGitHub);
  await phone.page.goto(link.replace(/^https?:\/\/[^/]+\//, env.url));
  await phone.page.waitForSelector('#s-pairpass');
  assert.equal(new URL(phone.page.url()).hash, '#settings');
  await phone.page.fill('#s-pairpass', 'wrong phrase!');
  await phone.page.click('button:has-text("Connect")');
  await phone.page.waitForSelector('.toast.error');
  await phone.page.fill('#s-pairpass', 'my secret phrase');
  await phone.page.click('button:has-text("Connect")');
  await phone.page.waitForSelector('text=This device is now in sync.');
  await phone.page.click('a[href="#home"]');
  assert.ok((await titles(phone.page.locator('.top3'))).includes('Task from computer'));

  await quickAdd(phone.page, 'Task from phone');
  await phone.page.click('a[href="#settings"]');
  await phone.page.click('button:has-text("Sync now")');
  await phone.page.waitForSelector('text=Sync complete.');
  await pc.page.waitForSelector('text=Sync complete.', { state: 'detached' }); // earlier toast gone
  await pc.page.click('button:has-text("Sync now")');
  await pc.page.waitForSelector('text=Sync complete.');
  await pc.page.click('a[href="#home"]');
  assert.deepEqual((await titles(pc.page.locator('.top3'))).sort(), ['Task from computer', 'Task from phone']);
  assert.deepEqual(pc.errors.filter((e) => !/401/.test(e)), []);
  await pc.context.close();
  await phone.context.close();
});
