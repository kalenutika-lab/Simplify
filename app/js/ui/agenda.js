// Agenda: day and week views, overdue list, rescheduling with confirmation, reminders.
import { html, useState, Section, DateField, confirmDialog, fmtDay, fmtStamp } from './common.js';
import { t, weekdayShort } from '../i18n.js';
import { state, liveTasks, updateTask, toast, findProject } from '../store.js';
import { todayYMD, addDays, startOfWeek, weekday, formatDMY } from '../core/dates.js';
import { deadlineInfo } from '../core/scoring.js';
import { upcomingReminders } from '../core/reminders.js';
import { TaskCard } from './tasks.js';
import { openEditor } from './editor.js';

/** Moving a deadline always asks first; the app never moves one by itself. */
export async function reschedule(task, to) {
  if (!to || to === task.dueDate) return;
  const ok = await confirmDialog({
    title: t('moveTo'),
    body: t('moveConfirm', { title: task.title, from: task.dueDate ? formatDMY(task.dueDate) : '—', to: formatDMY(to) }),
    confirmLabel: t('move'),
  });
  if (!ok) return;
  await updateTask(task.id, { dueDate: to });
  toast(t('moved'));
}

function MovePanel({ task, onClose }) {
  const [date, setDate] = useState(null);
  const today = todayYMD();
  const base = task.dueDate && task.dueDate > today ? task.dueDate : today;
  const nextMon = addDays(today, ((1 - weekday(today) + 7) % 7) || 7);
  const go = async (d) => { onClose(); await reschedule(task, d); };
  return html`<div class="move-panel">
    <div class="row gap wrap">
      <button class="chip" onClick=${() => go(addDays(base, 1))}>${t('plus1')}</button>
      <button class="chip" onClick=${() => go(addDays(base, 2))}>${t('plus2')}</button>
      <button class="chip" onClick=${() => go(nextMon)}>${t('nextMonday')}</button>
    </div>
    <div class="row gap end-align">
      <${DateField} id=${`mv-${task.id}`} label=${t('pickNewDate')} quick=${false} value=${date} onChange=${setDate} />
      <button class="btn small primary" disabled=${!date || date === 'invalid'} onClick=${() => go(date)}>${t('move')}</button>
      <button class="btn small" onClick=${onClose}>${t('cancel')}</button>
    </div>
  </div>`;
}

function AgendaItem({ task }) {
  const [moving, setMoving] = useState(false);
  return html`<div class="agenda-item">
    <ul class="tasks"><${TaskCard} task=${task} compact /></ul>
    ${!task.done && html`<button class="btn small move-btn" aria-expanded=${moving} onClick=${() => setMoving(!moving)}>${t('move')}</button>`}
    ${moving && html`<${MovePanel} task=${task} onClose=${() => setMoving(false)} />`}
  </div>`;
}

const byTime = (a, b) => (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') || a.title.localeCompare(b.title);

export function Agenda() {
  const today = todayYMD();
  const [mode, setMode] = useState(() => (globalThis.innerWidth > 800 ? 'week' : 'day'));
  const [day, setDay] = useState(today);
  const tasks = liveTasks();
  const now = new Date();
  const forDay = (d) => tasks.filter((x) => x.dueDate === d).sort(byTime);
  const overdue = tasks.filter((x) => !x.done && deadlineInfo(x, now).status === 'overdue').sort((a, b) => (a.dueDate + (a.dueTime || '')).localeCompare(b.dueDate + (b.dueTime || '')));
  const noDate = tasks.filter((x) => !x.done && !x.dueDate).length;
  const ws = startOfWeek(day, state.prefs.weekStart);
  const step = mode === 'week' ? 7 : 1;
  const rems = upcomingReminders(tasks, now, 7);

  return html`<div class="view agenda">
    <header class="page-head"><h1>${t('tab_agenda')}</h1></header>
    <div class="row gap wrap center toolbar">
      <div class="seg" role="tablist">
        <button role="tab" aria-selected=${mode === 'day'} class=${mode === 'day' ? 'on' : ''} onClick=${() => setMode('day')}>${t('dayView')}</button>
        <button role="tab" aria-selected=${mode === 'week'} class=${mode === 'week' ? 'on' : ''} onClick=${() => setMode('week')}>${t('weekView')}</button>
      </div>
      <button class="btn small" aria-label=${t('prev')} onClick=${() => setDay(addDays(day, -step))}>‹</button>
      <button class="btn small" onClick=${() => setDay(today)}>${t('goToday')}</button>
      <button class="btn small" aria-label=${t('next')} onClick=${() => setDay(addDays(day, step))}>›</button>
      <strong class="period">${mode === 'week' ? t('weekOf', { date: formatDMY(ws) }) : `${weekdayShort(weekday(day))} ${formatDMY(day)}`}</strong>
    </div>

    ${overdue.length > 0 && html`<${Section} title=${`${t('overdueSection')} (${overdue.length})`} cls="danger-card">
      ${overdue.map((x) => html`<${AgendaItem} key=${x.id} task=${x} />`)}
    <//>`}

    ${mode === 'day'
      ? html`<${Section} title=${fmtDay(day)}>
          ${forDay(day).length ? forDay(day).map((x) => html`<${AgendaItem} key=${x.id} task=${x} />`) : html`<p class="empty">${t('agendaEmptyDay')}</p>`}
        <//>`
      : html`<div class="week">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
          const d = addDays(ws, i);
          const list = forDay(d);
          return html`<section key=${d} class=${`card day ${d === today ? 'is-today' : ''}`}>
            <h2><button class="btn link" onClick=${() => { setDay(d); setMode('day'); }}>${weekdayShort(weekday(d))} ${formatDMY(d).slice(0, 5)}</button></h2>
            ${list.length ? list.map((x) => html`<${AgendaItem} key=${x.id} task=${x} />`) : html`<p class="empty small">—</p>`}
          </section>`;
        })}</div>`}

    <p class="muted">${t('noDeadlineTasks', { n: noDate })}</p>

    <${Section} title=${t('upcomingReminders')}>
      ${rems.length === 0 ? html`<p class="empty">${t('noReminders')}</p>` : html`<ul class="plain">${rems.map((r) => html`<li key=${r.reminder.id}>🔔 ${fmtStamp(r.time.toISOString())} · <button class="btn link" onClick=${() => openEditor(r.task.id)}>${r.task.title}</button>${r.task.projectId && findProject(r.task.projectId) ? html` <span class="muted">${findProject(r.task.projectId).name}</span>` : ''}</li>`)}</ul>`}
    <//>
  </div>`;
}

