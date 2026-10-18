// Projects: list with progress, editor, reorder, archive and restore.
import { html, useState, Section, DateField, confirmDialog, fmtDay, fmtMinutes } from './common.js';
import { t } from '../i18n.js';
import { state, liveProjects, liveTasks, createProject, updateProject, moveProject, deleteProject, toast } from '../store.js';
import { projectStats, behindReasons } from '../core/stats.js';
import { rankTasks } from '../core/scoring.js';
import { PRIORITIES } from '../core/model.js';
import { TaskList } from './tasks.js';
import { QuickAdd } from './home.js';

const COLORS = ['#0891b2', '#9333ea', '#16a34a', '#2563eb', '#db2777', '#e11d48', '#4f46e5', '#0d9488', '#c026d3', '#5b6b7a'];

function ProjectEditor({ project, onClose }) {
  const [f, setF] = useState({
    name: project?.name || '',
    description: project?.description || '',
    objective: project?.objective || '',
    priority: project?.priority || 'medium',
    mandatory: !!project?.mandatory,
    boost: String(project?.boost ?? 0),
    color: project?.color || COLORS[0],
    targetDate: project?.targetDate || null,
    notes: project?.notes || '',
    linksText: (project?.links || []).join('\n'),
  });
  const [err, setErr] = useState({});
  const set = (p) => setF({ ...f, ...p });
  async function save() {
    const e = {};
    if (!f.name.trim()) e.name = t('nameRequired');
    if (f.targetDate === 'invalid') e.targetDate = t('invalidDate');
    const boost = Number(f.boost);
    if (!Number.isFinite(boost) || boost < -100 || boost > 100) e.boost = '-100 … 100';
    setErr(e);
    if (Object.keys(e).length) return;
    const fields = {
      name: f.name.trim(), description: f.description, objective: f.objective, priority: f.priority, mandatory: f.mandatory,
      boost, color: f.color, targetDate: f.targetDate || null, notes: f.notes, links: f.linksText.split('\n').map((s) => s.trim()).filter(Boolean),
    };
    if (project) await updateProject(project.id, fields);
    else await createProject(fields);
    toast(t('saved'));
    onClose();
  }
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pe-title">
      <div class="sheet-head row between center"><h2 id="pe-title">${project ? t('editProject') : t('newProject')}</h2>
        <button class="btn ghost" onClick=${onClose} aria-label=${t('close')}>✕</button></div>
      <div class="sheet-body">
        <div class="field"><label for="p-name">${t('name')}</label><input id="p-name" value=${f.name} onInput=${(e) => set({ name: e.target.value })} class=${err.name ? 'invalid' : ''} />${err.name && html`<p class="error">${err.name}</p>`}</div>
        <div class="field"><label for="p-desc">${t('description')}</label><textarea id="p-desc" rows="2" value=${f.description} onInput=${(e) => set({ description: e.target.value })}></textarea></div>
        <div class="field"><label for="p-obj">${t('objective')}</label><textarea id="p-obj" rows="2" value=${f.objective} onInput=${(e) => set({ objective: e.target.value })}></textarea></div>
        <div class="grid2">
          <div class="field"><label for="p-prio">${t('priority')}</label><select id="p-prio" value=${f.priority} onChange=${(e) => set({ priority: e.target.value })}>${PRIORITIES.map((p) => html`<option value=${p}>${t(`prio_${p}`)}</option>`)}</select></div>
          <label class="check-row"><input type="checkbox" checked=${f.mandatory} onChange=${(e) => set({ mandatory: e.target.checked })} /> ${t('mandatoryProject')}</label>
        </div>
        <div class="field"><label for="p-boost">${t('boost')}</label><input id="p-boost" inputmode="numeric" value=${f.boost} onInput=${(e) => set({ boost: e.target.value })} class=${err.boost ? 'invalid' : ''} />
          <p class="hint">${t('boostHelp')}</p>${err.boost && html`<p class="error">${err.boost}</p>`}</div>
        <${DateField} id="p-target" label=${t('targetDate')} value=${f.targetDate} error=${err.targetDate} onChange=${(v) => set({ targetDate: v })} />
        <div class="field"><span class="label">${t('color')}</span><div class="row gap wrap">${COLORS.map((c) => html`<button type="button" class=${`swatch ${f.color === c ? 'on' : ''}`} style=${`background:${c}`} aria-label=${c} aria-pressed=${f.color === c} onClick=${() => set({ color: c })}></button>`)}</div></div>
        <div class="field"><label for="p-notes">${t('notes')}</label><textarea id="p-notes" rows="3" value=${f.notes} onInput=${(e) => set({ notes: e.target.value })}></textarea></div>
        <div class="field"><label for="p-links">${t('links')}</label><textarea id="p-links" rows="2" value=${f.linksText} onInput=${(e) => set({ linksText: e.target.value })}></textarea></div>
      </div>
      <div class="sheet-foot row gap end"><button class="btn" onClick=${onClose}>${t('cancel')}</button><button class="btn primary" onClick=${save}>${t('save')}</button></div>
    </div>
  </div>`;
}

function ProjectCard({ p, index, count, onEdit }) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const s = projectStats(p, liveTasks(), now);
  const behind = behindReasons(p, s, now);
  const ranked = rankTasks(state.tasks, state.projects, state.prefs, now).filter((r) => r.task.projectId === p.id);
  const done = liveTasks().filter((x) => x.projectId === p.id && x.done);
  async function archive() {
    await updateProject(p.id, { archived: !p.archived });
    toast(p.archived ? t('projectRestored') : t('projectArchived'));
  }
  async function remove() {
    const ok = await confirmDialog({ title: t('delete'), body: t('confirmDeleteProject', { name: p.name, n: s.total }), confirmLabel: t('delete'), danger: true });
    if (ok) await deleteProject(p.id);
  }
  return html`<section class=${`card project ${p.archived ? 'archived' : ''}`} style=${`--pc:${p.color}`} data-project-id=${p.id}>
    <div class="row between center gap">
      <button class="proj-head grow" aria-expanded=${open} onClick=${() => setOpen(!open)}>
        <span class="dot"></span>
        <span class="grow left"><strong>${p.name}</strong>${p.mandatory ? html` <span class="badge">${t('mandatory')}</span>` : ''}${p.archived ? html` <span class="badge">${t('archived')}</span>` : ''}
          <span class="muted block">${t('progressOf', { done: s.done, total: s.total, open: s.open })}${s.estimateOpenMin ? ` · ${fmtMinutes(s.estimateOpenMin)}` : ''}${p.targetDate ? ` · ${t('target', { date: fmtDay(p.targetDate) })}` : ''}</span></span>
        <span class="pct">${s.percent}%</span>
      </button>
    </div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${s.percent} aria-label=${p.name}><span style=${`width:${s.percent}%`}></span></div>
    ${behind.length > 0 && html`<p class="warn-text">${behind.map((x) => t(x.key, { ...x.params, date: x.params.date ? fmtDay(x.params.date) : '' })).join(' · ')}</p>`}
    ${open && html`<div class="proj-body">
      ${p.description && html`<p>${p.description}</p>`}
      ${p.objective && html`<p><strong>${t('objective')}:</strong> ${p.objective}</p>`}
      ${p.notes && html`<p class="pre">${p.notes}</p>`}
      ${p.links.length > 0 && html`<ul class="links">${p.links.map((l) => html`<li><a href=${/^https?:\/\//i.test(l) ? l : `https://${l}`} target="_blank" rel="noopener noreferrer">${l}</a></li>`)}</ul>`}
      ${!p.archived && html`<${QuickAdd} projectId=${p.id} />`}
      <h3>${t('openTasks')} (${ranked.length})</h3>
      <${TaskList} items=${ranked} empty=${t('noTasksYet')} />
      ${done.length > 0 && html`<details><summary>${t('doneTasks')} (${done.length})</summary><${TaskList} items=${done} compact empty="" /></details>`}
      <div class="row gap wrap actions">
        <button class="btn small" onClick=${() => onEdit(p)}>${t('editProject')}</button>
        ${!p.archived && html`<button class="btn small" disabled=${index === 0} onClick=${() => moveProject(p.id, -1)}>↑ ${t('moveUp')}</button>
        <button class="btn small" disabled=${index === count - 1} onClick=${() => moveProject(p.id, 1)}>↓ ${t('moveDown')}</button>`}
        <button class="btn small" onClick=${archive}>${p.archived ? t('restore') : t('archive')}</button>
        <button class="btn small danger-text" onClick=${remove}>${t('delete')}</button>
      </div>
    </div>`}
  </section>`;
}

export function Projects() {
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const all = liveProjects();
  const active = all.filter((p) => !p.archived);
  const archived = all.filter((p) => p.archived);
  return html`<div class="view projects">
    <header class="page-head row between center"><h1>${t('tab_projects')}</h1>
      <button class="btn primary" onClick=${() => setEditing({ project: null })}>+ ${t('newProject')}</button></header>
    ${active.length === 0 && html`<p class="empty">${t('projectsEmpty')}</p>`}
    ${active.map((p, i) => html`<${ProjectCard} key=${p.id} p=${p} index=${i} count=${active.length} onEdit=${(x) => setEditing({ project: x })} />`)}
    ${archived.length > 0 && html`<label class="check-row"><input type="checkbox" checked=${showArchived} onChange=${(e) => setShowArchived(e.target.checked)} /> ${t('showArchived')} (${archived.length})</label>`}
    ${showArchived && archived.map((p) => html`<${ProjectCard} key=${p.id} p=${p} index=${0} count=${1} onEdit=${(x) => setEditing({ project: x })} />`)}
    ${editing && html`<${ProjectEditor} project=${editing.project} onClose=${() => setEditing(null)} />`}
  </div>`;
}
