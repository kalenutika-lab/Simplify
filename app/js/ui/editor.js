// Task editor (full form). Also used to confirm quick-add results before saving.
import { html, useState, useEffect, useRef, DateField, TimeField, confirmDialog, fmtStamp, download, fmtDay } from './common.js';
import { t } from '../i18n.js';
import { state, findTask, createTask, updateTask, deleteTask, restoreTask, duplicateTask, liveProjects, liveTasks, toast } from '../store.js';
import { makeReminder, PRIORITIES } from '../core/model.js';
import { buildICS, googleCalendarUrl } from '../core/ics.js';
import { fromLocalISO, isValidYMD, formatDMY, toLocalISO } from '../core/dates.js';
import { reminderTime } from '../core/reminders.js';

let openFn = null;
/** openEditor(taskId) edits a task; openEditor(null, draftFields, extras) creates one. */
export function openEditor(id, draft = null, extras = null) {
  if (openFn) openFn({ id, draft, extras });
}

function formFrom(task) {
  return {
    title: task.title || '',
    description: task.description || '',
    projectId: task.projectId || '',
    dueDate: task.dueDate || null,
    dueTime: task.dueTime || null,
    priority: task.priority || state.prefs.defaultPriority,
    mandatory: !!task.mandatory,
    estimate: task.estimateMin ? String(task.estimateMin) : '',
    manual: task.manual || 'normal',
    checklist: (task.checklist || []).map((c) => ({ ...c })),
    blockedBy: [...(task.blockedBy || [])],
    notes: task.notes || '',
    linksText: (task.links || []).join('\n'),
    reminders: (task.reminders || []).map((r) => ({ ...r })),
  };
}

function dependsOn(taskId, targetId, seen = new Set()) {
  if (taskId === targetId) return true;
  if (seen.has(taskId)) return false;
  seen.add(taskId);
  const t0 = state.tasks.find((x) => x.id === taskId);
  return !!t0 && (t0.blockedBy || []).some((b) => dependsOn(b, targetId, seen));
}

const PRESETS = [0, 10, 30, 60, 120, 1440, 2880, 10080];
function presetLabel(m) {
  if (m === 0) return t('remAtDeadline');
  if (m < 60) return t('remMin', { n: m });
  if (m < 1440) return t('remHours', { n: +(m / 60).toFixed(2) });
  return t('remDays', { n: +(m / 1440).toFixed(2) });
}

export function EditorHost() {
  const [ed, setEd] = useState(null);
  const [form, setForm] = useState(null);
  const initial = useRef('');
  const pushed = useRef(false);
  const ignorePop = useRef(false);
  const [errors, setErrors] = useState({});
  const [newItem, setNewItem] = useState('');

  const dirty = form && JSON.stringify(form) !== initial.current;
  const dirtyRef = useRef(false);
  dirtyRef.current = !!dirty;

  openFn = ({ id, draft, extras }) => {
    const task = id ? findTask(id) : { ...draft };
    if (!task) return;
    const f = formFrom(task);
    if (!id && !f.reminders.length && state.prefs.defaultReminderMinutes != null) {
      f.reminders = [makeReminder({ kind: 'before', minutes: state.prefs.defaultReminderMinutes })];
    }
    initial.current = id ? JSON.stringify(f) : '';
    setForm(f);
    setErrors({});
    setNewItem('');
    setEd({ id, extras });
    if (!pushed.current) { history.pushState({ ppmModal: 1 }, ''); pushed.current = true; }
  };

  const reallyClose = () => {
    setEd(null);
    setForm(null);
    if (pushed.current) { pushed.current = false; ignorePop.current = true; history.back(); }
  };

  const requestClose = async () => {
    if (dirtyRef.current) {
      const ok = await confirmDialog({ title: t('unsavedTitle'), body: t('unsavedBody'), confirmLabel: t('discard'), cancelLabel: t('keepEditing'), danger: true });
      if (!ok) return;
    }
    reallyClose();
  };

  useEffect(() => {
    const onPop = async () => {
      if (ignorePop.current) { ignorePop.current = false; return; }
      if (!pushed.current) return;
      pushed.current = false;
      if (dirtyRef.current) {
        const ok = await confirmDialog({ title: t('unsavedTitle'), body: t('unsavedBody'), confirmLabel: t('discard'), cancelLabel: t('keepEditing'), danger: true });
        if (!ok) { history.pushState({ ppmModal: 1 }, ''); pushed.current = true; return; }
      }
      setEd(null);
      setForm(null);
    };
    const onUnload = (e) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('beforeunload', onUnload); };
  }, []);

  if (!ed || !form) return null;
  const existing = ed.id ? findTask(ed.id) : null;
  if (ed.id && !existing) return null;
  const set = (patch) => setForm({ ...form, ...patch });
  const projects = liveProjects().filter((p) => !p.archived || p.id === form.projectId);
  const candidates = liveTasks().filter((x) => !x.done && x.id !== ed.id && !form.blockedBy.includes(x.id));

  function validate() {
    const e = {};
    if (!form.title.trim()) e.title = t('titleRequired');
    if (form.dueDate === 'invalid') e.dueDate = t('invalidDate');
    if (form.dueTime === 'invalid') e.dueTime = t('invalidTime');
    else if (form.dueTime && !form.dueDate) e.dueTime = t('timeNeedsDate');
    if (form.estimate.trim()) {
      const n = Number(form.estimate);
      if (!Number.isInteger(n) || n < 1 || n > 10080) e.estimate = t('invalidEstimate');
    }
    form.reminders.forEach((r) => {
      if (r.kind === 'at' && !fromLocalISO(r.at)) e[`rem_${r.id}`] = t('remInvalid');
      if (r.kind === 'before' && !(Number.isFinite(Number(r.minutes)) && Number(r.minutes) >= 0)) e[`rem_${r.id}`] = t('remInvalid');
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    const fields = {
      title: form.title.trim(),
      description: form.description,
      projectId: form.projectId || null,
      dueDate: form.dueDate || null,
      dueTime: form.dueDate ? form.dueTime || null : null,
      priority: form.priority,
      mandatory: form.mandatory,
      estimateMin: form.estimate.trim() ? Number(form.estimate) : null,
      manual: form.manual,
      checklist: form.checklist.filter((c) => c.text.trim()),
      blockedBy: form.blockedBy,
      notes: form.notes,
      links: form.linksText.split('\n').map((s) => s.trim()).filter(Boolean),
      reminders: form.reminders.map((r) => ({ ...r, minutes: r.kind === 'before' ? Number(r.minutes) : null })),
    };
    if (existing) {
      await updateTask(existing.id, fields);
      toast(t('saved'));
    } else {
      await createTask(fields);
      toast(t('taskAdded'));
    }
    initial.current = JSON.stringify(form);
    dirtyRef.current = false;
    reallyClose();
  }

  async function remove() {
    const ok = await confirmDialog({ title: t('delete'), body: t('confirmDeleteTask', { title: existing.title }), confirmLabel: t('delete'), danger: true });
    if (!ok) return;
    const old = await deleteTask(existing.id);
    dirtyRef.current = false;
    reallyClose();
    toast(t('taskDeleted'), { action: { label: t('undo'), run: () => restoreTask(old) } });
  }

  async function confirmDiscard() {
    if (!dirtyRef.current) return true;
    return confirmDialog({ title: t('unsavedTitle'), body: t('unsavedBody'), confirmLabel: t('discard'), cancelLabel: t('keepEditing'), danger: true });
  }

  async function dup() {
    if (!(await confirmDiscard())) return;
    const c = await duplicateTask(existing.id, t('copySuffix'));
    toast(t('duplicated'));
    dirtyRef.current = false;
    reallyClose();
    setTimeout(() => openEditor(c.id), 50);
  }

  async function toggleDone() {
    if (!(await confirmDiscard())) return;
    await updateTask(existing.id, { done: !existing.done });
    toast(existing.done ? t('taskReopened') : t('taskDone'));
    dirtyRef.current = false;
    reallyClose();
  }

  const extras = ed.extras;
  const savedTask = existing;
  const projectName = savedTask && savedTask.projectId ? (liveProjects().find((p) => p.id === savedTask.projectId) || {}).name : '';
  const gcal = savedTask && savedTask.dueDate && !dirty ? googleCalendarUrl(savedTask, { projectName }) : null;

  const updRem = (id, patch) => set({ reminders: form.reminders.map((r) => (r.id === id ? { ...r, ...patch, firedFor: null } : r)) });

  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && requestClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ed-title">
      <div class="sheet-head row between center">
        <h2 id="ed-title">${existing ? t('editTask') : t('newTask')}</h2>
        <button class="btn ghost" onClick=${requestClose} aria-label=${t('close')}>✕</button>
      </div>
      <div class="sheet-body">
        ${extras && extras.recognized && extras.recognized.length > 0 && html`<div class="notice">${t('understood')}</div>`}
        ${extras && extras.ambiguities && extras.ambiguities.map((a) => html`<div class="notice warn">
          <p>${t(`amb_${a.reason}`, { text: a.text })}</p>
          ${a.options && html`<div class="row gap wrap">${a.options.map((o) => html`<button type="button" class=${`chip ${form.dueDate === o ? 'on' : ''}`} onClick=${() => set({ dueDate: o })}>${fmtDay(o) === formatDMY(o) ? formatDMY(o) : `${fmtDay(o)} · ${formatDMY(o)}`}</button>`)}</div>`}
        </div>`)}

        <div class="field">
          <label for="f-title">${t('title')}</label>
          <input id="f-title" value=${form.title} onInput=${(e) => set({ title: e.target.value })} class=${errors.title ? 'invalid' : ''} maxlength="500" />
          ${errors.title && html`<p class="error">${errors.title}</p>`}
        </div>

        <div class="grid2">
          <div class="field">
            <label for="f-project">${t('project')}</label>
            <select id="f-project" value=${form.projectId} onChange=${(e) => set({ projectId: e.target.value })}>
              <option value="">${t('noProject')}</option>
              ${projects.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
            </select>
          </div>
          <div class="field">
            <label for="f-prio">${t('priority')}</label>
            <select id="f-prio" value=${form.priority} onChange=${(e) => set({ priority: e.target.value })}>
              ${PRIORITIES.map((p) => html`<option value=${p}>${t(`prio_${p}`)}</option>`)}
            </select>
          </div>
        </div>

        <fieldset><legend>${t('deadline')}</legend>
          <div class="grid2">
            <${DateField} id="f-date" label=${t('deadlineDate')} value=${form.dueDate} error=${errors.dueDate} onChange=${(v) => set({ dueDate: v })} />
            <${TimeField} id="f-time" label=${t('deadlineTime')} value=${form.dueTime} error=${errors.dueTime} onChange=${(v) => set({ dueTime: v })} />
          </div>
        </fieldset>

        <div class="grid2">
          <label class="check-row"><input type="checkbox" checked=${form.mandatory} onChange=${(e) => set({ mandatory: e.target.checked })} /> ${t('mandatory')}</label>
          <div class="field">
            <label for="f-est">${t('estimate')}</label>
            <input id="f-est" inputmode="numeric" value=${form.estimate} onInput=${(e) => set({ estimate: e.target.value })} class=${errors.estimate ? 'invalid' : ''} placeholder="90" />
            ${errors.estimate && html`<p class="error">${errors.estimate}</p>`}
          </div>
        </div>

        <div class="field">
          <label for="f-manual">${t('manualOverride')}</label>
          <select id="f-manual" value=${form.manual} onChange=${(e) => set({ manual: e.target.value })}>
            ${['normal', 'pin', 'later'].map((m) => html`<option value=${m}>${t(`manual_${m}`)}</option>`)}
          </select>
        </div>

        <fieldset><legend>${t('reminders')}</legend>
          ${form.dueDate && isValidYMD(form.dueDate) && !form.dueTime && form.reminders.some((r) => r.kind === 'before') && html`<p class="hint">${t('remDateOnlyNote')}</p>`}
          ${form.reminders.map((r) => {
            const live = existing ? existing.reminders.find((x) => x.id === r.id) : null;
            const when = live && savedTask ? reminderTime(savedTask, live) : null;
            const [atDate, atTime] = r.at ? r.at.split('T') : [null, null];
            return html`<div class="reminder" key=${r.id}>
              <div class="row gap wrap center">
                <select aria-label=${t('reminders')} value=${r.kind} onChange=${(e) => updRem(r.id, e.target.value === 'at' ? { kind: 'at', at: r.at || toLocalISO(new Date(Date.now() + 3600000)).slice(0, 14) + '00' } : { kind: 'before', minutes: r.minutes ?? 60 })}>
                  <option value="before">${t('remBefore')}</option>
                  <option value="at">${t('remAt')}</option>
                </select>
                ${r.kind === 'before' && html`<select aria-label=${t('remMinutesBefore')} value=${String(r.minutes)} onChange=${(e) => updRem(r.id, { minutes: Number(e.target.value) })}>
                  ${(PRESETS.includes(Number(r.minutes)) ? PRESETS : [...PRESETS, Number(r.minutes)]).map((m) => html`<option value=${String(m)}>${presetLabel(m)}</option>`)}
                </select>`}
                <label class="check-row"><input type="checkbox" checked=${r.enabled} onChange=${(e) => updRem(r.id, { enabled: e.target.checked })} /> ${t('remOn')}</label>
                <button type="button" class="btn small ghost" aria-label=${t('delete')} onClick=${() => set({ reminders: form.reminders.filter((x) => x.id !== r.id) })}>✕</button>
              </div>
              ${r.kind === 'at' && html`<div class="grid2">
                <${DateField} id=${`rd-${r.id}`} label=${t('deadlineDate')} quick=${false} value=${atDate} onChange=${(v) => updRem(r.id, { at: `${v || ''}T${atTime || '09:00'}` })} />
                <${TimeField} id=${`rt-${r.id}`} label="HH:MM" value=${atTime} onChange=${(v) => updRem(r.id, { at: `${atDate || ''}T${v || ''}` })} />
              </div>`}
              ${r.kind === 'before' && !form.dueDate && html`<p class="hint warn">${t('remNeedsDeadline')}</p>`}
              ${live && live.snoozedUntil && html`<p class="hint">${t('remSnoozed', { time: fmtStamp(fromLocalISO(live.snoozedUntil).toISOString()) })}</p>`}
              ${when && live.firedFor === toLocalISO(when) && html`<p class="hint">✓ ${t('remFired')} (${fmtStamp(when.toISOString())})</p>`}
              ${errors[`rem_${r.id}`] && html`<p class="error">${errors[`rem_${r.id}`]}</p>`}
            </div>`;
          })}
          <button type="button" class="btn small" onClick=${() => set({ reminders: [...form.reminders, makeReminder({ kind: 'before', minutes: 60 })] })}>+ ${t('addReminder')}</button>
          ${savedTask && savedTask.dueDate && html`<div class="calendar-links">
            <p class="hint">${t('calendarHelp')}</p>
            <div class="row gap wrap">
              ${gcal && html`<a class="btn small" href=${gcal} target="_blank" rel="noopener noreferrer">${t('addToGoogle')}</a>`}
              <button type="button" class="btn small" disabled=${dirty} onClick=${() => download(`${savedTask.title.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40) || 'task'}.ics`, buildICS(savedTask, { projectName }), 'text/calendar')}>${t('downloadIcs')}</button>
            </div>
          </div>`}
        </fieldset>

        <fieldset><legend>${t('checklist')}</legend>
          <ul class="checklist">${form.checklist.map((c) => html`<li key=${c.id} class="row gap center">
            <input type="checkbox" aria-label=${c.text} checked=${c.done} onChange=${(e) => set({ checklist: form.checklist.map((x) => (x.id === c.id ? { ...x, done: e.target.checked } : x)) })} />
            <input class="grow" value=${c.text} onInput=${(e) => set({ checklist: form.checklist.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })} />
            <button type="button" class="btn small ghost" aria-label=${t('delete')} onClick=${() => set({ checklist: form.checklist.filter((x) => x.id !== c.id) })}>✕</button>
          </li>`)}</ul>
          <form class="row gap" onSubmit=${(e) => { e.preventDefault(); if (newItem.trim()) { set({ checklist: [...form.checklist, { id: `chk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: newItem.trim(), done: false }] }); setNewItem(''); } }}>
            <input class="grow" placeholder=${t('itemPlaceholder')} value=${newItem} onInput=${(e) => setNewItem(e.target.value)} />
            <button class="btn small">${t('addItem')}</button>
          </form>
        </fieldset>

        <fieldset><legend>${t('blockedBy')}</legend>
          <p class="hint">${t('blockedByHelp')}</p>
          <div class="row gap wrap">${form.blockedBy.map((id) => {
            const b = state.tasks.find((x) => x.id === id && !x.deleted);
            return b ? html`<span class="chip on" key=${id}>${b.done ? '✓ ' : ''}${b.title} <button type="button" class="x" aria-label=${t('delete')} onClick=${() => set({ blockedBy: form.blockedBy.filter((x) => x !== id) })}>✕</button></span>` : null;
          })}</div>
          ${candidates.length > 0 && html`<select aria-label=${t('blockedBy')} value="" onChange=${(e) => {
            const id = e.target.value;
            if (!id) return;
            if (ed.id && dependsOn(id, ed.id)) { e.target.value = ''; toast(t('depLoop'), { kind: 'error' }); return; }
            set({ blockedBy: [...form.blockedBy, id] });
          }}>
            <option value="">+ …</option>
            ${candidates.map((c) => html`<option value=${c.id}>${c.title}</option>`)}
          </select>`}
        </fieldset>

        <div class="field"><label for="f-desc">${t('description')}</label><textarea id="f-desc" rows="3" value=${form.description} onInput=${(e) => set({ description: e.target.value })}></textarea></div>
        <div class="field"><label for="f-notes">${t('notes')}</label><textarea id="f-notes" rows="3" value=${form.notes} onInput=${(e) => set({ notes: e.target.value })}></textarea></div>
        <div class="field"><label for="f-links">${t('links')}</label><textarea id="f-links" rows="2" value=${form.linksText} onInput=${(e) => set({ linksText: e.target.value })} placeholder="https://"></textarea>
          ${savedTask && savedTask.links.length > 0 && html`<ul class="links">${savedTask.links.map((l) => html`<li><a href=${/^https?:\/\//i.test(l) ? l : `https://${l}`} target="_blank" rel="noopener noreferrer">${l}</a></li>`)}</ul>`}
        </div>

        ${existing && html`<p class="hint">${t('created', { date: fmtStamp(existing.createdAt) })} · ${t('updated', { date: fmtStamp(existing.updatedAt) })}${existing.postponeCount ? ` · ${t('postponed', { n: existing.postponeCount })}` : ''}</p>`}
      </div>
      <div class="sheet-foot row gap wrap">
        ${existing && html`<button class="btn" onClick=${toggleDone}>${existing.done ? t('reopen') : t('markDone')}</button>`}
        ${existing && html`<button class="btn" onClick=${dup}>${t('duplicate')}</button>`}
        ${existing && html`<button class="btn danger-text" onClick=${remove}>${t('delete')}</button>`}
        <span class="grow"></span>
        <button class="btn" onClick=${requestClose}>${t('cancel')}</button>
        <button class="btn primary" onClick=${save}>${t('save')}</button>
      </div>
    </div>
  </div>`;
}
