// Android app (Capacitor) integration. In the Android app, reminders are handed to the
// phone's own alarm system so they ring even when the app is closed. Nothing leaves the
// phone for this. In a normal browser none of this runs.
import { planNotifications } from './core/notifyplan.js';

export const isNative = !!(globalThis.Capacitor && typeof globalThis.Capacitor.isNativePlatform === 'function' && globalThis.Capacitor.isNativePlatform());

let ln = null;
async function plugin() {
  if (!ln) {
    const { registerPlugin } = await import('./vendor/capacitor-core.js');
    ln = registerPlugin('LocalNotifications');
  }
  return ln;
}

export async function initNative({ onOpenTask, channelName }) {
  if (!isNative) return;
  const p = await plugin();
  await p.createChannel({ id: 'reminders', name: channelName, importance: 5, visibility: 1, vibration: true });
  await p.addListener('localNotificationActionPerformed', (e) => {
    const id = e && e.notification && e.notification.extra && e.notification.extra.taskId;
    if (id) onOpenTask(id);
  });
}

/** 'granted' | 'denied' | 'prompt' */
export async function notificationPermission() {
  if (!isNative) return 'unsupported';
  const r = await (await plugin()).checkPermissions();
  return r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'prompt';
}

export async function requestNotificationPermission() {
  const r = await (await plugin()).requestPermissions();
  return r.display;
}

let lastPlan = '';
let lastText = (x) => ({ title: x.title, body: '' });
let running = Promise.resolve();

/** Replace the phone's scheduled reminders with the current plan. `text(item)` gives title/body. */
export function rescheduleAll(tasks, text = lastText) {
  if (!isNative) return Promise.resolve();
  lastText = text;
  running = running.then(async () => {
    const p = await plugin();
    if ((await p.checkPermissions()).display !== 'granted') { lastPlan = ''; return; }
    const plan = planNotifications(tasks, new Date());
    const items = plan.map((x) => ({ ...x, ...text(x) }));
    const sig = JSON.stringify(items.map((x) => [x.id, x.at.getTime(), x.title, x.body]));
    if (sig === lastPlan) return;
    const pending = await p.getPending();
    if (pending.notifications.length) await p.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    if (items.length) {
      await p.schedule({
        notifications: items.map((x) => ({
          id: x.id, title: x.title, body: x.body, channelId: 'reminders',
          schedule: { at: x.at, allowWhileIdle: true }, extra: { taskId: x.taskId },
          smallIcon: 'ic_stat_notify', iconColor: '#db2777',
        })),
      });
    }
    lastPlan = sig;
  }).catch((e) => { lastPlan = ''; console.warn('reminder scheduling failed', e); });
  return running;
}
