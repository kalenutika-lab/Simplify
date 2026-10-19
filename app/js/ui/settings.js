// Settings: language, defaults, scoring, reminders, sync, backup, deletion, limitations.
import { html, useState, Section, confirmDialog, download, fmtStamp } from './common.js';
import { t } from '../i18n.js';
import { state, setPrefs, setDevice, exportJSON, previewImport, applyImport, wipeEverything, syncNow, connectWithPairCode, toast } from '../store.js';
import { makePairCode, pairLink, extractPairCode } from '../core/pair.js';
import qrcode from '../vendor/qrcode.js';
import { DEFAULT_WEIGHTS, PRIORITIES } from '../core/model.js';
import { todayYMD } from '../core/dates.js';
import { APP_VERSION, installState, promptInstall, showSystemNotification } from '../platform.js';

function NumberInput({ id, value, onCommit, min = 0, max = 100000, step = 1, scale = 1 }) {
  const [text, setText] = useState(String(+(value / scale).toFixed(2)));
  const [bad, setBad] = useState(false);
  return html`<input id=${id} inputmode="decimal" class=${bad ? 'invalid' : ''} value=${text}
    onInput=${(e) => setText(e.target.value)}
    onBlur=${() => {
      const n = Number(String(text).replace(',', '.'));
      if (!Number.isFinite(n) || n * scale < min || n * scale > max) { setBad(true); return; }
      setBad(false);
      onCommit(Math.round((n * scale) / step) * step);
    }} />`;
}

function General() {
  const p = state.prefs;
  const d = state.device;
  return html`<${Section} title=${`${t('language')} · ${t('appearance')}`}>
    <div class="grid2">
      <div class="field"><label for="s-lang">${t('language')}</label>
        <select id="s-lang" value=${d.lang} onChange=${(e) => setDevice({ lang: e.target.value })}>
          <option value="en">English</option><option value="fr">Français</option>
        </select></div>
      <div class="field"><label for="s-theme">${t('appearance')}</label>
        <select id="s-theme" value=${d.theme} onChange=${(e) => setDevice({ theme: e.target.value })}>
          ${['system', 'light', 'dark'].map((x) => html`<option value=${x}>${t(`theme_${x}`)}</option>`)}
        </select></div>
      <div class="field"><label for="s-prio">${t('defaultPriority')}</label>
        <select id="s-prio" value=${p.defaultPriority} onChange=${(e) => setPrefs({ defaultPriority: e.target.value })}>
          ${PRIORITIES.map((x) => html`<option value=${x}>${t(`prio_${x}`)}</option>`)}
        </select></div>
      <div class="field"><label for="s-week">${t('weekStart')}</label>
        <select id="s-week" value=${String(p.weekStart)} onChange=${(e) => setPrefs({ weekStart: Number(e.target.value) })}>
          <option value="1">${t('monday')}</option><option value="0">${t('sunday')}</option>
        </select></div>
    </div>
    <fieldset><legend>${t('focusTime')}</legend>
      <div class="grid2">
        <div class="field"><label for="s-fwd">${t('weekdays')}</label><${NumberInput} id="s-fwd" value=${p.focusWeekday} scale=${60} max=${1440} onCommit=${(v) => setPrefs({ focusWeekday: v })} /></div>
        <div class="field"><label for="s-fwe">${t('weekends')}</label><${NumberInput} id="s-fwe" value=${p.focusWeekend} scale=${60} max=${1440} onCommit=${(v) => setPrefs({ focusWeekend: v })} /></div>
      </div>
    </fieldset>
  <//>`;
}

function Scoring() {
  const w = state.prefs.weights;
  return html`<${Section} title=${t('scoring')}>
    <p class="hint">${t('scoringHelp')}</p>
    <div class="weights" key=${JSON.stringify(w)}>
      ${Object.keys(DEFAULT_WEIGHTS).map((k) => html`<div class="field inline" key=${k}>
        <label for=${`w-${k}`}>${t(`w_${k}`)}</label>
        <${NumberInput} id=${`w-${k}`} value=${w[k]} min=${-100000} onCommit=${(v) => setPrefs({ weights: { ...state.prefs.weights, [k]: v } })} />
      </div>`)}
    </div>
    <p class="hint">${t('projectBoosts')}</p>
    <button class="btn small" onClick=${() => setPrefs({ weights: { ...DEFAULT_WEIGHTS } })}>${t('resetDefaults')}</button>
  <//>`;
}

function Notifications() {
  const supported = 'Notification' in globalThis;
  const perm = supported ? Notification.permission : 'unsupported';
  const d = state.device;
  async function toggle(on) {
    if (!on) { await setDevice({ notifications: false }); return; }
    if (!supported) return;
    let p = Notification.permission;
    if (p === 'default') p = await Notification.requestPermission();
    await setDevice({ notifications: p === 'granted' });
  }
  const dr = state.prefs.defaultReminderMinutes;
  return html`<${Section} title=${t('notifSection')}>
    <p class="hint">${t('notifLimits')}</p>
    ${!supported ? html`<p class="warn-text">${t('notifUnsupported')}</p>` : html`
      <label class="check-row"><input type="checkbox" checked=${d.notifications && perm === 'granted'} disabled=${perm === 'denied'} onChange=${(e) => toggle(e.target.checked)} /> ${t('notifEnable')}</label>
      ${perm === 'denied' && html`<p class="warn-text">${t('notifDenied')}</p>`}
      ${d.notifications && perm === 'granted' && html`<button class="btn small" onClick=${() => showSystemNotification(t('appName'), t('notifTestBody'), 'test')}>${t('notifTest')}</button>`}
    `}
    <div class="field"><label for="s-defrem">${t('defaultReminder')}</label>
      <select id="s-defrem" value=${dr == null ? '' : String(dr)} onChange=${(e) => setPrefs({ defaultReminderMinutes: e.target.value === '' ? null : Number(e.target.value) })}>
        <option value="">${t('noDefaultReminder')}</option>
        ${[0, 30, 60, 120, 1440].map((m) => html`<option value=${String(m)}>${m === 0 ? t('remAtDeadline') : m < 60 ? t('remMin', { n: m }) : m < 1440 ? t('remHours', { n: m / 60 }) : t('remDays', { n: m / 1440 })}</option>`)}
      </select></div>
  <//>`;
}

function syncError(e) {
  toast(t(`se_${e.code || e.message || 'unknown'}`, { detail: e.detail || '' }), { kind: 'error', timeout: 8000 });
}

/** Shown on the first device once sync works: a QR code and link for the other device. */
function PairPanel() {
  const s = state.device.sync;
  const [link, setLink] = useState('');
  if (!link) {
    makePairCode(s.token, s.passphrase).then((code) => setLink(pairLink(location.href, code)));
    return html`<p class="muted">…</p>`;
  }
  const qr = qrcode(0, 'L');
  qr.addData(link);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  async function copy() {
    try { await navigator.clipboard.writeText(link); toast(t('pairCopied')); } catch { toast(t('pairCopyFailed'), { kind: 'error' }); }
  }
  async function share() {
    try { await navigator.share({ title: t('appName'), url: link }); } catch { /* cancelled */ }
  }
  return html`<div class="pair">
    <ol>${t('pairShowSteps').map((x) => html`<li>${x}</li>`)}</ol>
    <div class="qr" dangerouslySetInnerHTML=${{ __html: svg }} aria-label=${t('pairQrLabel')} role="img"></div>
    <input class="pair-link" readonly aria-label=${t('pairPaste')} value=${link} onFocus=${(e) => e.target.select()} />
    <div class="row gap wrap">
      <button class="btn small" onClick=${copy}>${t('pairCopy')}</button>
      ${'share' in navigator && html`<button class="btn small" onClick=${share}>${t('pairShare')}</button>`}
    </div>
    <p class="hint">${t('pairSafe')}</p>
  </div>`;
}

/** On the second device: finish setup with a code from the first device and the passphrase. */
function PairJoin() {
  const [text, setText] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const code = state.pairCode || extractPairCode(text);
  async function join() {
    if (!code) { toast(t('se_badPairCode'), { kind: 'error' }); return; }
    setBusy(true);
    try {
      await connectWithPairCode(code, pass);
      toast(t('pairDone'));
    } catch (e) {
      syncError(e);
    } finally {
      setBusy(false);
    }
  }
  return html`<div class="pair notice">
    <h3>${t('pairJoinTitle')}</h3>
    ${state.pairCode ? html`<p>${t('pairReceived')}</p>` : html`
      <p>${t('pairJoinIntro')}</p>
      <div class="field"><label for="s-paircode">${t('pairPaste')}</label><input id="s-paircode" autocomplete="off" value=${text} onInput=${(e) => setText(e.target.value)} /></div>`}
    <div class="field"><label for="s-pairpass">${t('syncPass')}</label><input id="s-pairpass" type="password" autocomplete="current-password" value=${pass} onInput=${(e) => setPass(e.target.value)} /></div>
    <button class="btn primary" disabled=${busy || !code || !pass} onClick=${join}>${busy ? t('syncing') : t('pairJoin')}</button>
  </div>`;
}

function Sync() {
  const s = state.device.sync;
  const [token, setToken] = useState(s.token);
  const [pass, setPass] = useState(s.passphrase);
  const [show, setShow] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [first, setFirst] = useState(false);
  async function enable() {
    if (!token.trim()) { toast(t('se_noToken'), { kind: 'error' }); return; }
    if (pass.length < 8) { toast(t('se_shortPassphrase'), { kind: 'error' }); return; }
    await setDevice({ sync: { enabled: true, token: token.trim(), passphrase: pass, lastError: null } });
    if (await run()) setPairing(true);
  }
  async function run() {
    try {
      await syncNow({ manual: true });
      toast(t('syncOk'));
      return true;
    } catch (e) {
      syncError(e);
      return false;
    }
  }
  async function disable() {
    await setDevice({ sync: { enabled: false, token: '', passphrase: '', gistId: '', lastError: null } });
    setToken('');
    setPass('');
    setPairing(false);
  }
  return html`<${Section} title=${t('syncSection')}>
    <p>${t('syncIntro')}</p>
    ${!s.enabled && html`
      <${PairJoin} />
      ${!state.pairCode && html`<details open=${first} onToggle=${(e) => setFirst(e.target.open)}><summary>${t('syncFirstDevice')}</summary>
        <ol>${t('syncStepList').map((x) => html`<li>${x}</li>`)}</ol>
        <div class="field"><label for="s-token">${t('syncToken')}</label><input id="s-token" type=${show ? 'text' : 'password'} autocomplete="off" value=${token} onInput=${(e) => setToken(e.target.value)} /></div>
        <div class="field"><label for="s-pass">${t('syncPass')}</label><input id="s-pass" type=${show ? 'text' : 'password'} autocomplete="new-password" value=${pass} onInput=${(e) => setPass(e.target.value)} /></div>
        <label class="check-row"><input type="checkbox" checked=${show} onChange=${(e) => setShow(e.target.checked)} /> ${t('syncShow')}</label>
        <button class="btn primary" onClick=${enable}>${t('syncEnable')}</button>
      </details>`}`}
    ${s.enabled && html`
      <p class="muted">${s.lastSync ? t('syncedAt', { time: fmtStamp(s.lastSync) }) : t('neverSynced')}</p>
      ${s.lastError && html`<p class="warn-text">${t(`se_${s.lastError}`, { detail: '' })}</p>`}
      <div class="row gap wrap">
        <button class="btn primary" disabled=${state.sync.running} onClick=${run}>${state.sync.running ? t('syncing') : t('syncNow')}</button>
        <button class="btn" aria-expanded=${pairing} onClick=${() => setPairing(!pairing)}>${t('pairShow')}</button>
        <button class="btn" onClick=${disable}>${t('syncDisable')}</button>
      </div>
      ${pairing && html`<${PairPanel} />`}`}
    <p class="hint">${t('syncWarn')}</p>
  <//>`;
}

function Backup() {
  const [mode, setMode] = useState('merge');
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    setPlan(null);
    setError(null);
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setError('ie_notJson'); return; }
    const text = await file.text();
    const p = previewImport(text, mode);
    if (p.error) { setError(`ie_${p.error}`); return; }
    setPlan({ ...p, mode });
  }
  async function apply() {
    if (plan.mode === 'replace') {
      const ok = await confirmDialog({ title: t('mode_replace'), body: t('imp_replaceConfirm'), typeWord: t('confirmWord_replace'), confirmLabel: t('importApply'), danger: true });
      if (!ok) return;
    }
    await applyImport(plan, plan.mode);
    setPlan(null);
    toast(t('imp_done'));
  }
  const r = plan && plan.report;
  return html`<${Section} title=${t('backupSection')}>
    <p class="hint">${t('backupHelp')}</p>
    <button class="btn primary" onClick=${() => { download(`project-manager-backup-${todayYMD()}.json`, exportJSON()); toast(t('exported')); }}>${t('exportBtn')}</button>
    <fieldset><legend>${t('importBtn')}</legend>
      <div class="field"><label for="s-mode">${t('importMode')}</label>
        <select id="s-mode" value=${mode} onChange=${(e) => { setMode(e.target.value); setPlan(null); }}>
          <option value="merge">${t('mode_merge')}</option><option value="replace">${t('mode_replace')}</option>
        </select></div>
      <input type="file" accept="application/json,.json" aria-label=${t('importBtn')} onChange=${onFile} />
      ${error && html`<p class="error" role="alert">${t(error)}</p>`}
      ${r && html`<div class="import-report" role="status">
        <h3>${t('importPreview')}</h3>
        <ul class="plain">
          <li>${t('imp_added', { n: r.added })}</li>
          <li>${t('imp_updated', { n: r.updated })}</li>
          <li>${t('imp_unchanged', { n: r.unchanged })}</li>
          ${plan.mode === 'merge' && html`<li>${t('imp_keptLocal', { n: r.keptLocal })}</li>`}
          <li class=${r.rejected.length ? 'warn-text' : ''}>${t('imp_rejected', { n: r.rejected.length })}</li>
        </ul>
        ${r.rejected.length > 0 && html`<ul class="rejected">${r.rejected.slice(0, 50).map((x) => html`<li>${t('imp_rejectedItem', { kind: t(`kind_${x.kind}`), index: x.index, label: x.label, reason: t(`rr_${x.reason}`) })}</li>`)}</ul>`}
        ${r.warnings.length > 0 && html`<ul class="rejected">${r.warnings.slice(0, 50).map((x) => html`<li>${t('imp_warnMissing', { label: x.label })}</li>`)}</ul>`}
        <div class="row gap"><button class="btn" onClick=${() => setPlan(null)}>${t('cancel')}</button><button class="btn primary" onClick=${apply}>${t('importApply')}</button></div>
      </div>`}
    </fieldset>
  <//>`;
}

function Danger() {
  async function wipe() {
    const ok = await confirmDialog({ title: t('wipeBtn'), body: t('wipeConfirm'), typeWord: t('confirmWord_delete'), confirmLabel: t('delete'), danger: true });
    if (!ok) return;
    await wipeEverything();
    toast(t('wipeDone'));
  }
  return html`<${Section} title=${t('dangerSection')}>
    <button class="btn danger" onClick=${wipe}>${t('wipeBtn')}</button>
  <//>`;
}

function Limits() {
  const inst = installState();
  return html`<${Section} title=${t('limitsSection')}>
    <ul>${t('limitsList').map((x) => html`<li>${x}</li>`)}</ul>
    ${state.persisted === true && html`<p class="muted">${t('storagePersisted')}</p>`}
    ${state.persisted === false && html`<p class="warn-text">${t('storageNotPersisted')}</p>`}
    <h3>${t('about')}</h3>
    <p class="muted">${t('version', { v: APP_VERSION })}</p>
    <p class="hint">${t('installHelp')}</p>
    ${inst.canPrompt && html`<button class="btn" onClick=${promptInstall}>${t('installBtn')}</button>`}
  <//>`;
}

export function Settings() {
  return html`<div class="view settings">
    <header class="page-head"><h1>${t('tab_settings')}</h1></header>
    <${General} />
    <${Notifications} />
    <${Sync} />
    <${Backup} />
    <${Scoring} />
    <${Limits} />
    <${Danger} />
  </div>`;
}
