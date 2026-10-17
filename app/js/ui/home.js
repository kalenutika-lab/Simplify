// Home: daily priorities, quick-add and the full ranked list.
import { html, useState, Section, fmtMinutes, fmtDay } from './common.js';
import { t, weekdayLong, monthName } from '../i18n.js';
import { state, liveTasks, liveProjects, createTask, toast } from '../store.js';
import { rankTasks, topTasks, fitDay } from '../core/scoring.js';
import { overview } from '../core/stats.js';
import { parseQuickAdd } from '../core/parse.js';
import { todayYMD, addDays, isWeekend, weekday } from '../core/dates.js';
import { TaskList } from './tasks.js';
import { openEditor } from './editor.js';

export function QuickAdd({ projectId = null }) {
  const [text, setText] = useState('');
  const [help, setHelp] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const raw = text.trim();
    if (!raw) return;
    const p = parseQuickAdd(raw, { projects: liveProjects() });
    const fields = {
      title: p.title,
      dueDate: p.dueDate,
      dueTime: p.dueDate ? p.dueTime : null,
      priority: p.priority || state.prefs.defaultPriority,
      mandatory: p.mandatory,
      estimateMin: p.estimateMin,
      projectId: p.projectId || projectId,
    };
    setText('');
    if (p.recognized.length === 0 && p.ambiguities.length === 0) {
      await createTask(fields);
      toast(t('taskAdded'));
      return;
    }
    // Something was interpreted: show it for confirmation before saving.
    openEditor(null, fields, { recognized: p.recognized, ambiguities: p.ambiguities });
  }
  return html`<form class="quickadd" onSubmit=${submit}>
    <div class="row gap">
      <input class="grow" aria-label=${t('newTask')} placeholder=${t('quickPlaceholder')} value=${text} onInput=${(e) => setText(e.target.value)} enterkeyhint="done" maxlength="500" />
      <button class="btn primary">${t('add')}</button>
      <button type="button" class="btn ghost" aria-expanded=${help} aria-label="?" onClick=${() => setHelp(!help)}>?</button>
    </div>
    ${help && html`<p class="hint">${t('quickHelp')}</p>`}
  </form>`;
}

const FILTERS = ['today', 'overdue', 'upcoming', 'all', 'nodate', 'done'];

function applyFilter(filter, ranked, projectFilter, query, sort) {
  let items;
  if (filter === 'done') {
    items = liveTasks().filter((x) => x.done).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  } else {
    items = ranked.filter((r) => {
      if (filter === 'today') return r.status === 'today';
      if (filter === 'overdue') return r.status === 'overdue';
      if (filter === 'upcoming') return r.status === 'upcoming';
      if (filter === 'nodate') return r.status === 'none';
      return true;
    });
  }
  const task = (x) => x.task || x;
  if (projectFilter) items = items.filter((x) => (projectFilter === 'none' ? !task(x).projectId : task(x).projectId === projectFilter));
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    items = items.filter((x) => `${task(x).title} ${task(x).description} ${task(x).notes}`.toLowerCase().includes(q));
  }
  if (filter !== 'done' && sort !== 'score') {
    const order = new Map(liveProjects().map((p, i) => [p.id, i]));
    const key = {
      deadline: (x) => (task(x).dueDate ? `${task(x).dueDate}T${task(x).dueTime || '23:59'}` : '9999'),
      created: (x) => task(x).createdAt,
      project: (x) => String(order.has(task(x).projectId) ? order.get(task(x).projectId) : 999).padStart(4, '0'),
    }[sort];
    items = [...items].sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (ka === kb) return 0;
      const asc = ka < kb ? -1 : 1;
      return sort === 'created' ? -asc : asc;
    });
  }
  return items;
}

export function Home() {
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('score');
  const [projectFilter, setProjectFilter] = useState('');
  const [query, setQuery] = useState('');
  const now = new Date();
  const today = todayYMD(now);
  const ranked = rankTasks(state.tasks, state.projects, state.prefs, now);
  const top = topTasks(ranked, 3);
  const overdue = ranked.filter((r) => r.status === 'overdue');
  const dueToday = ranked.filter((r) => r.status === 'today');
  const in7 = addDays(today, 7);
  const upcoming = ranked
    .filter((r) => r.status === 'upcoming' && r.task.dueDate <= in7)
    .sort((a, b) => `${a.task.dueDate}${a.task.dueTime || '99'}`.localeCompare(`${b.task.dueDate}${b.task.dueTime || '99'}`));
  const cap = isWeekend(today) ? state.prefs.focusWeekend : state.prefs.focusWeekday;
  const fit = fitDay(ranked, cap);
  const ov = overview(state.tasks, state.projects, state.prefs, now);
  const items = applyFilter(filter, ranked, projectFilter, query, sort);
  const [y, m, d] = today.split('-').map(Number);
  const dateTitle = `${weekdayLong(weekday(today))} ${d} ${monthName(m)} ${y}`;

  return html`<div class="view home">
    <header class="page-head">
      <h1>${dateTitle}</h1>
      <p class="muted">${t('workLeft', { open: ov.open, est: fmtMinutes(ov.openEstimateMin), estMin: ov.openEstimateMin, noEst: ov.openWithoutEstimate })}</p>
    </header>
    <${QuickAdd} />

    <${Section} title=${t('top3')} cls="top3">
      <${TaskList} items=${top} empty=${t('top3Empty')} />
    <//>

    <div class="grid-home">
      <${Section} title=${`${t('overdue')} (${overdue.length})`} cls=${overdue.length ? 'danger-card' : ''}>
        <${TaskList} items=${overdue.slice(0, 5)} compact empty=${t('nothingOverdue')} />
        ${overdue.length > 5 && html`<button class="btn link" onClick=${() => setFilter('overdue')}>+${overdue.length - 5}</button>`}
      <//>
      <${Section} title=${`${t('dueToday')} (${dueToday.length})`}>
        <${TaskList} items=${dueToday.slice(0, 5)} compact empty=${t('nothingToday')} />
        ${dueToday.length > 5 && html`<button class="btn link" onClick=${() => setFilter('today')}>+${dueToday.length - 5}</button>`}
      <//>
      <${Section} title=${t('upcomingDeadlines')}>
        <${TaskList} items=${upcoming.slice(0, 6)} compact empty=${t('nothingUpcoming')} />
        ${upcoming.length > 6 && html`<button class="btn link" onClick=${() => setFilter('upcoming')}>+${upcoming.length - 6}</button>`}
      <//>
    </div>

    <${Section} title=${t('fitTitle')}>
      <p>${fit.fits.length ? t('fitSummary', { cap: fmtMinutes(cap), n: fit.fits.length, used: fmtMinutes(fit.used), left: fmtMinutes(fit.left) }) : t('fitNone', { cap: fmtMinutes(cap) })}</p>
      ${fit.fits.length > 0 && html`<ol class="fit">${fit.fits.map((r) => html`<li key=${r.task.id}><button class="btn link" onClick=${() => openEditor(r.task.id)}>${r.task.title}</button> <span class="muted">${fmtMinutes(r.task.estimateMin)}</span></li>`)}</ol>`}
      ${fit.tooBig.length > 0 && html`<p class="muted">${t('fitTooBig', { n: fit.tooBig.length })} ${fit.tooBig.map((r) => `${r.task.title} (${fmtMinutes(r.task.estimateMin)})`).join(', ')}</p>`}
      ${fit.noEstimate.length > 0 && html`<p class="muted">${t('fitNoEst', { n: fit.noEstimate.length })}</p>`}
      <p class="hint">${t('fitNote')}</p>
    <//>

    ${ov.behind.length > 0 && html`<${Section} title=${t('behindTitle')}>
      <ul class="plain">${ov.behind.map((b) => html`<li key=${b.project.id}><span class="proj" style=${`--pc:${b.project.color}`}>${b.project.name}</span> <span class="muted">${b.behind.map((x) => t(x.key, { ...x.params, date: x.params.date ? fmtDay(x.params.date) : '' })).join(' · ')}</span></li>`)}</ul>
    <//>`}

    <${Section} title=${t('allTasks')}>
      <div class="filters" role="tablist">
        ${FILTERS.map((f) => html`<button role="tab" aria-selected=${filter === f} class=${`chip ${filter === f ? 'on' : ''}`} onClick=${() => setFilter(f)}>${t(`filter_${f}`)}</button>`)}
      </div>
      <div class="row gap wrap filters2">
        <input type="search" aria-label=${t('search')} placeholder=${t('search')} value=${query} onInput=${(e) => setQuery(e.target.value)} />
        <select aria-label=${t('project')} value=${projectFilter} onChange=${(e) => setProjectFilter(e.target.value)}>
          <option value="">${t('allProjects')}</option>
          <option value="none">${t('noProject')}</option>
          ${liveProjects().filter((p) => !p.archived).map((p) => html`<option value=${p.id}>${p.name}</option>`)}
        </select>
        ${filter !== 'done' && html`<select aria-label=${t('sortBy')} value=${sort} onChange=${(e) => setSort(e.target.value)}>
          ${['score', 'deadline', 'created', 'project'].map((s) => html`<option value=${s}>${t('sortBy')}: ${t(`sort_${s}`)}</option>`)}
        </select>`}
      </div>
      <${TaskList} items=${items} empty=${filter === 'done' ? t('emptyDone') : t('emptyFilter')} />
    <//>
  </div>`;
}

