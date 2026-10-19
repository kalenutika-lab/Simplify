// App shell: tabs, reminders loop, toasts and dialogs.
import { html, render, useState, useEffect } from './vendor/htm-preact.js';
import { t } from './i18n.js';
import { state, subscribe, init, checkReminders, dismissToast, toast, onError, setNotifier, snoozeReminder, dismissAlert, findTask, setDone, syncNow } from './store.js';
import { DialogHost } from './ui/common.js';
import { EditorHost, openEditor } from './ui/editor.js';
import { Home } from './ui/home.js';
import { Projects } from './ui/projects.js';
import { Agenda } from './ui/agenda.js';
import { Progress } from './ui/progress.js';
import { Settings } from './ui/settings.js';
import { initPlatform, onUpdateReady, applyUpdate, showSystemNotification } from './platform.js';
import { fmtStamp } from './ui/common.js';
import { extractPairCode } from './core/pair.js';

const icon = (d) => html`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d.map((x) => html`<path d=${x} />`)}</svg>`;
const TABS = [
  { id: 'home', icon: ['M3 11l9-7 9 7', 'M5 10v10h14V10'], view: Home },
  { id: 'projects', icon: ['M3 6h7l2 2h9v11H3z'], view: Projects },
  { id: 'agenda', icon: ['M4 5h16v15H4z', 'M4 10h16', 'M9 3v4', 'M15 3v4'], view: Agenda },
  { id: 'progress', icon: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'], view: Progress },
  { id: 'settings', icon: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.5-1.5M5.5 18.5L7 17M17 17l1.5 1.5M5.5 5.5L7 7'], view: Settings },
];

// A pairing link from another device opens Settings with the code ready to use.
function takePairCode() {
  if (!location.hash.startsWith('#pair=')) return;
  state.pairCode = extractPairCode(location.hash);
  history.replaceState(null, '', '#settings');
}
takePairCode();

const tabFromHash = () => {
  const h = location.hash.replace('#', '');
  return TABS.some((x) => x.id === h) ? h : 'home';
};

function Alerts() {
  if (!state.alerts.length) return null;
  return html`<div class="alerts" role="alert">${state.alerts.map((a) => {
    const task = findTask(a.taskId);
    if (!task) return null;
    return html`<div class="alert" key=${a.taskId + a.reminderId}>
      <div><strong>🔔 ${t('reminderTitle')}:</strong> ${task.title}<div class="muted">${fmtStamp(a.time)}</div></div>
      <div class="row gap wrap">
        <button class="btn small" onClick=${() => { dismissAlert(a.taskId, a.reminderId); openEditor(task.id); }}>${t('open')}</button>
        <button class="btn small" onClick=${() => snoozeReminder(a.taskId, a.reminderId, 10)}>${t('snooze10')}</button>
        <button class="btn small" onClick=${() => snoozeReminder(a.taskId, a.reminderId, 60)}>${t('snooze60')}</button>
        <button class="btn small" onClick=${async () => { dismissAlert(a.taskId, a.reminderId); await setDone(task.id, true); toast(t('taskDone')); }}>${t('markDone')}</button>
        <button class="btn small ghost" onClick=${() => dismissAlert(a.taskId, a.reminderId)}>${t('dismiss')}</button>
      </div>
    </div>`;
  })}</div>`;
}

function Toasts() {
  return html`<div class="toasts" aria-live="polite">${state.toasts.map((x) => html`<div class=${`toast ${x.kind}`} key=${x.id}>
    <span>${x.message}</span>
    ${x.action && html`<button class="btn small" onClick=${() => { x.action.run(); dismissToast(x.id); }}>${x.action.label}</button>`}
  </div>`)}</div>`;
}

function applyTheme() {
  const theme = state.device.theme;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.lang = state.device.lang;
}

function App() {
  const [, setV] = useState(0);
  const [tab, setTab] = useState(tabFromHash());
  const [update, setUpdate] = useState(false);
  useEffect(() => {
    const off = subscribe((v) => setV(v));
    setV(state.version); // catch changes emitted before this subscription existed
    return off;
  }, []);
  useEffect(() => {
    const onHash = () => { takePairCode(); setTab(tabFromHash()); };
    window.addEventListener('hashchange', onHash);
    onUpdateReady(() => setUpdate(true));
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { applyTheme(); document.title = t('appName'); });

  if (state.fatal) return html`<main class="fatal"><h1>${t('appName')}</h1><p>${t('fatal', { msg: state.fatal })}</p></main>`;
  if (!state.ready) return html`<main class="loading"><p>${t('loading')}</p></main>`;
  const View = TABS.find((x) => x.id === tab).view;
  const go = (id) => { if (location.hash !== `#${id}`) location.hash = id; setTab(id); window.scrollTo(0, 0); };
  return html`<div class="app">
    <nav class="tabs" aria-label="Main">
      <div class="brand">${t('appName')}</div>
      ${TABS.map((x) => html`<a href=${`#${x.id}`} class=${`tab ${tab === x.id ? 'on' : ''}`} aria-current=${tab === x.id ? 'page' : null}
        onClick=${(e) => { e.preventDefault(); go(x.id); }}><span class="ico">${icon(x.icon)}</span><span>${t(`tab_${x.id}`)}</span></a>`)}
      ${state.sync.running && html`<span class="sync-dot" title=${t('syncing')}>⟳</span>`}
    </nav>
    <main id="main">
      ${update && html`<div class="notice row between center"><span>${t('updateReady')}</span><button class="btn small primary" onClick=${applyUpdate}>${t('reload')}</button></div>`}
      <${Alerts} />
      <${View} />
    </main>
    <${EditorHost} />
    <${DialogHost} />
    <${Toasts} />
  </div>`;
}

onError((e) => toast(t('saveFailed', { msg: (e && e.message) || String(e) }), { kind: 'error', timeout: 10000 }));
setNotifier((d) => {
  if (state.device.notifications) showSystemNotification(t('reminderTitle'), d.task.title, `${d.task.id}:${d.reminder.id}`, d.task.id);
});

render(html`<${App} />`, document.getElementById('root'));
initPlatform({ onOpenTask: (id) => openEditor(id) });

init().then(() => {
  applyTheme();
  checkReminders();
  setInterval(() => checkReminders(), 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkReminders();
      const last = state.device.sync.lastSync ? Date.parse(state.device.sync.lastSync) : 0;
      if (Date.now() - last > 60000) syncNow();
    }
  });
  window.addEventListener('online', () => syncNow());
  syncNow();
  const params = new URLSearchParams(location.search);
  if (params.get('task')) openEditor(params.get('task'));
});
