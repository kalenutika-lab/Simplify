// Shared UI pieces: formatting, dialogs, date/time fields.
import { html, useState, useEffect, useRef } from '../vendor/htm-preact.js';
import { t, weekdayShort } from '../i18n.js';
import { formatDMY, parseDMY, parseHM, todayYMD, addDays, diffDays, weekday, minutesLabel, toYMD, toHM } from '../core/dates.js';
import { deadlineInfo } from '../core/scoring.js';

export { html, useState, useEffect, useRef };

// ---------- formatting ----------

export function fmtDay(ymd, today = todayYMD()) {
  const d = diffDays(today, ymd);
  if (d === 0) return t('due_today');
  if (d === 1) return t('due_tomorrow');
  if (d === -1) return t('due_yesterday');
  if (d > 1 && d < 7) return `${weekdayShort(weekday(ymd))} ${formatDMY(ymd).slice(0, 5)}`;
  return formatDMY(ymd);
}

/** Deadline label and tone for a task card. */
export function dueLabel(task, now = new Date()) {
  if (!task.dueDate) return null;
  const info = deadlineInfo(task, now);
  let text = fmtDay(task.dueDate, todayYMD(now));
  if (task.dueTime) text += ` ${task.dueTime}`;
  if (!task.done && info.status === 'overdue') text += ` · ${info.days < 0 ? t('lateDays', { days: -info.days }) : t('lateToday')}`;
  const tone = task.done ? 'muted' : info.status === 'overdue' ? 'danger' : info.status === 'today' ? 'warn' : info.days !== null && info.days <= 3 ? 'soon' : 'normal';
  return { text, tone };
}

export function fmtStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${formatDMY(toYMD(d))} ${toHM(d)}`;
}

export const fmtMinutes = (min) => minutesLabel(min) || '0 min';

export function reasonText(r) {
  return t(`r_${r.key}`, r.params || {});
}

// ---------- dialogs (one at a time, promise based) ----------

let dialogSetter = null;
export function DialogHost() {
  const [dlg, setDlg] = useState(null);
  dialogSetter = setDlg;
  const [typed, setTyped] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    setTyped('');
    if (dlg && ref.current) ref.current.focus();
  }, [dlg]);
  if (!dlg) return null;
  const finish = (v) => { setDlg(null); dlg.resolve(v); };
  const blocked = dlg.typeWord && typed.trim().toUpperCase() !== dlg.typeWord;
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && finish(false)}>
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">${dlg.title}</h2>
      ${dlg.body && html`<p>${dlg.body}</p>`}
      ${dlg.typeWord && html`<label class="field"><span>${t('typeToConfirm', { word: dlg.typeWord })}</span>
        <input ref=${ref} value=${typed} onInput=${(e) => setTyped(e.target.value)} autocomplete="off" autocapitalize="characters" /></label>`}
      <div class="row end gap">
        <button class="btn" ref=${dlg.typeWord ? null : ref} onClick=${() => finish(false)}>${dlg.cancelLabel || t('cancel')}</button>
        <button class=${`btn ${dlg.danger ? 'danger' : 'primary'}`} disabled=${blocked} onClick=${() => finish(true)}>${dlg.confirmLabel || t('confirm')}</button>
      </div>
    </div>
  </div>`;
}

export function confirmDialog(opts) {
  return new Promise((resolve) => {
    if (!dialogSetter) { resolve(false); return; }
    dialogSetter({ ...opts, resolve });
  });
}

// ---------- fields ----------

/** Text date field in DD/MM/YYYY with quick buttons and the native picker as a helper. */
export function DateField({ label, value, onChange, error, quick = true, id }) {
  const [text, setText] = useState(value ? formatDMY(value) : '');
  const [bad, setBad] = useState(false);
  const picker = useRef(null);
  useEffect(() => {
    const cur = parseDMY(text);
    if ((cur || null) !== (value || null)) { setText(value ? formatDMY(value) : ''); setBad(false); }
  }, [value]);
  const commit = (s) => {
    setText(s);
    if (!s.trim()) { setBad(false); onChange(null); return; }
    const v = parseDMY(s);
    setBad(!v);
    onChange(v || 'invalid');
  };
  const set = (v) => { setText(v ? formatDMY(v) : ''); setBad(false); onChange(v); };
  const today = todayYMD();
  return html`<div class="field">
    <label for=${id}>${label}</label>
    <div class="row gap wrap">
      <input id=${id} class=${bad || error ? 'invalid' : ''} inputmode="numeric" placeholder="DD/MM/YYYY" value=${text}
        onInput=${(e) => commit(e.target.value)} aria-invalid=${bad || !!error} />
      <button type="button" class="btn small" onClick=${() => { const p = picker.current; if (p) { p.value = value && value !== 'invalid' ? value : today; if (p.showPicker) { try { p.showPicker(); return; } catch { /* fall through */ } } p.click(); } }}>${t('pickDate')}</button>
      <input ref=${picker} type="date" class="native-picker" tabindex="-1" aria-hidden="true" onChange=${(e) => e.target.value && set(e.target.value)} />
    </div>
    ${quick && html`<div class="row gap wrap quick">
      <button type="button" class="chip" onClick=${() => set(today)}>${t('today')}</button>
      <button type="button" class="chip" onClick=${() => set(addDays(today, 1))}>${t('tomorrow')}</button>
      <button type="button" class="chip" onClick=${() => set(addDays(value && value !== 'invalid' ? value : today, 7))}>${t('nextWeek')}</button>
      <button type="button" class="chip" onClick=${() => set(null)}>${t('clear')}</button>
    </div>`}
    ${(bad || error) && html`<p class="error">${error || t('invalidDate')}</p>`}
  </div>`;
}

export function TimeField({ label, value, onChange, error, id }) {
  const [text, setText] = useState(value || '');
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if ((parseHM(text) || null) !== (value || null)) { setText(value || ''); setBad(false); }
  }, [value]);
  return html`<div class="field">
    <label for=${id}>${label}</label>
    <input id=${id} class=${bad || error ? 'invalid' : ''} inputmode="numeric" placeholder="HH:MM" value=${text}
      onInput=${(e) => {
        const s = e.target.value;
        setText(s);
        if (!s.trim()) { setBad(false); onChange(null); return; }
        const v = parseHM(s);
        setBad(!v);
        onChange(v || 'invalid');
      }} />
    ${(bad || error) && html`<p class="error">${error || t('invalidTime')}</p>`}
  </div>`;
}

export function Section({ title, children, right, cls = '' }) {
  return html`<section class=${`card ${cls}`}>
    ${title && html`<div class="row between center"><h2>${title}</h2>${right || null}</div>`}
    ${children}
  </section>`;
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
