// Browser integration: service worker (offline + updates), install prompt, notifications.
export const APP_VERSION = '1.3.0';

let deferredPrompt = null;
let updateCallback = null;
let waitingWorker = null;

export function installState() {
  return { canPrompt: !!deferredPrompt };
}

export async function promptInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
}

export function onUpdateReady(fn) {
  updateCallback = fn;
}

export function applyUpdate() {
  if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  else location.reload();
}

export function initPlatform({ onOpenTask } = {}) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  // Reload only when a new version replaces a running one, not on the very first install.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'OPEN_TASK' && onOpenTask) onOpenTask(e.data.taskId);
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const track = (w) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          waitingWorker = w;
          if (updateCallback) updateCallback();
        }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) {
      waitingWorker = reg.waiting;
      if (updateCallback) updateCallback();
    }
    reg.addEventListener('updatefound', () => track(reg.installing));
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => { /* offline support unavailable; the app still works online */ });
}

/** Show a system notification. Uses the service worker so it works on Android Chrome. */
export async function showSystemNotification(title, body, tag, taskId = null) {
  if (!('Notification' in globalThis) || Notification.permission !== 'granted') return false;
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    const opts = { body, tag, renotify: false, data: { taskId }, icon: './icons/icon-192.png', badge: './icons/icon-192.png' };
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
    return true;
  } catch {
    return false;
  }
}
