// Task card and list.
import { html, useState, dueLabel, reasonText } from './common.js';
import { t } from '../i18n.js';
import { state, setDone, findProject, toast } from '../store.js';
import { openEditor } from './editor.js';
import { minutesLabel } from '../core/dates.js';

export async function toggleDone(task) {
  const next = !task.done;
  await setDone(task.id, next);
  toast(next ? t('taskDone') : t('taskReopened'), {
    action: { label: t('undo'), run: () => setDone(task.id, !next) },
  });
}

/** r: optional ranking entry { score, reasons, waitingOn } */
export function TaskCard({ task, r, compact = false }) {
  const [why, setWhy] = useState(false);
  const project = task.projectId ? findProject(task.projectId) : null;
  const due = dueLabel(task);
  const checklistDone = task.checklist.filter((c) => c.done).length;
  const waiting = r && r.waitingOn.length
    ? r.waitingOn.map((id) => state.tasks.find((x) => x.id === id)?.title).filter(Boolean).join(', ')
    : '';
  return html`<li class=${`task ${task.done ? 'is-done' : ''} ${due ? `tone-${due.tone}` : ''}`} data-task-id=${task.id}>
    <button class="check" role="checkbox" aria-checked=${task.done} aria-label=${task.done ? t('markOpen') : t('markDone')}
      onClick=${() => toggleDone(task)}><span aria-hidden="true">${task.done ? '✓' : ''}</span></button>
    <div class="task-main" role="button" tabindex="0" onClick=${() => openEditor(task.id)}
      onKeyDown=${(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openEditor(task.id))}>
      <div class="task-title">${task.title}</div>
      <div class="task-meta">
        ${project && html`<span class="proj" style=${`--pc:${project.color}`}>${project.name}</span>`}
        ${due && html`<span class=${`due ${due.tone}`}>${due.text}</span>`}
        <span class=${`prio ${task.priority}`}>${t(`prio_${task.priority}`)}</span>
        ${task.mandatory && html`<span class="badge">${t('mandatory')}</span>`}
        ${task.manual === 'pin' && html`<span class="badge">📌 ${t('pinned')}</span>`}
        ${task.manual === 'later' && html`<span class="badge">${t('later')}</span>`}
        ${task.estimateMin && html`<span class="muted">⏱ ${minutesLabel(task.estimateMin)}</span>`}
        ${task.checklist.length > 0 && html`<span class="muted">☑ ${checklistDone}/${task.checklist.length}</span>`}
        ${task.reminders.some((x) => x.enabled) && html`<span class="muted" aria-label=${t('reminders')}>🔔</span>`}
      </div>
      ${waiting && html`<div class="waiting">${t('waitingOn', { names: waiting })}</div>`}
    </div>
    ${r && !compact && html`<button class="score" aria-expanded=${why} onClick=${() => setWhy(!why)} title=${t('whyRank')}>${r.score}</button>`}
    ${r && why && html`<ul class="why">
      ${r.reasons.map((x) => html`<li><span>${reasonText(x)}</span><span>${x.points > 0 ? '+' : ''}${x.points}</span></li>`)}
      <li class="total"><span>${t('scoreLabel', { score: '' }).trim()}</span><span>${r.score}</span></li>
    </ul>`}
  </li>`;
}

export function TaskList({ items, empty, compact }) {
  if (!items.length) return html`<p class="empty">${empty}</p>`;
  return html`<ul class="tasks">${items.map((it) => (it.task
    ? html`<${TaskCard} key=${it.task.id} task=${it.task} r=${it} compact=${compact} />`
    : html`<${TaskCard} key=${it.id} task=${it} compact=${compact} />`))}</ul>`;
}
