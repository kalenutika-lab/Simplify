// Progress / review. Every number comes from stored tasks.
import { html, Section, fmtDay } from './common.js';
import { t, weekdayLong } from '../i18n.js';
import { state } from '../store.js';
import { overview } from '../core/stats.js';
import { TaskList } from './tasks.js';

export function Progress() {
  const ov = overview(state.tasks, state.projects, state.prefs, new Date());
  const tiles = [
    ['doneTodayL', ov.doneToday], ['doneWeekL', ov.doneWeek], ['outstandingL', ov.open],
    ['overdueL', ov.overdue], ['upcomingL', ov.upcoming7], ['noDeadlineL', ov.noDeadline],
  ];
  return html`<div class="view progress">
    <header class="page-head"><h1>${t('tab_progress')}</h1></header>
    <div class="tiles">${tiles.map(([k, v]) => html`<div class=${`tile ${k === 'overdueL' && v ? 'danger' : ''}`} key=${k}><strong>${v}</strong><span>${t(k)}</span></div>`)}</div>
    <p class="hint">${t('progressNote', { day: weekdayLong(state.prefs.weekStart) })}</p>

    <${Section} title=${t('byProject')}>
      <ul class="plain proj-progress">${ov.projects.map(({ project: p, stats: s }) => html`<li key=${p.id} style=${`--pc:${p.color}`}>
        <div class="row between"><span>${p.name}</span><span class="muted">${t('progressOf', { done: s.done, total: s.total, open: s.open })} · ${s.percent}%</span></div>
        <div class="bar" role="progressbar" aria-valuenow=${s.percent} aria-valuemin="0" aria-valuemax="100" aria-label=${p.name}><span style=${`width:${s.percent}%`}></span></div>
      </li>`)}</ul>
    <//>

    <${Section} title=${t('staleProjects')}>
      ${ov.stale.length === 0 ? html`<p class="empty">${t('noneStale')}</p>`
        : html`<ul class="plain">${ov.stale.map((x) => html`<li key=${x.project.id}><span class="proj" style=${`--pc:${x.project.color}`}>${x.project.name}</span> <span class="muted">${x.behind.map((b) => t(b.key, { ...b.params, date: b.params.date ? fmtDay(b.params.date) : '' })).join(' · ')}</span></li>`)}</ul>`}
    <//>

    <${Section} title=${t('postponedTitle')}>
      <${TaskList} items=${ov.postponed} empty=${t('nonePostponed')} />
      ${ov.postponed.length > 0 && html`<p class="hint">${ov.postponed.map((x) => `${x.title}: ${t('postponed', { n: x.postponeCount })}`).join(' · ')}</p>`}
    <//>
  </div>`;
}
