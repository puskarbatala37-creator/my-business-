import { api } from './api';
import { isIOS, isStandalone } from './pwa';

/**
 * Security notifications on this phone (Web Push). They arrive even when Slay is closed: the
 * phone's own push service (Google / Apple) wakes Slay's service worker, which shows them.
 */
export type PushState =
  /** Notifications are allowed and this phone is subscribed. */
  | 'on'
  /** Can be turned on (the phone will ask for permission). */
  | 'off'
  /** iPhone/iPad: only an app added to the Home Screen may show notifications. */
  | 'needs-install'
  /** Notifications were blocked for Slay in the phone's / browser's settings. */
  | 'blocked'
  | 'unsupported';

export interface NotificationPrefs {
  push: boolean;
  email: boolean;
  emailAvailable: boolean;
  /** This person's phones currently set up to receive notifications. */
  phones: number;
}

const supported = () =>
  import.meta.env.VITE_DEMO !== '1' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  // Wait for the service worker, but don't hang if it never starts (e.g. dev mode).
  return Promise.race([navigator.serviceWorker.ready, new Promise<undefined>((r) => setTimeout(r, 4000))]);
}

export async function pushState(): Promise<PushState> {
  if (isIOS && !isStandalone()) return 'needs-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Asks permission (if needed) and subscribes this phone. Must be called from a tap. */
export async function enablePush() {
  const state = await pushState();
  if (state === 'needs-install') throw new Error('On iPhone, add Slay to your Home Screen first, then open it from there and turn notifications on.');
  if (state === 'unsupported') throw new Error('This browser can’t show notifications. Try Chrome on Android, or Slay installed on an iPhone.');
  if (state === 'blocked') throw new Error(BLOCKED_HELP);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? BLOCKED_HELP : 'Notifications were not allowed.');
  const reg = await registration();
  if (!reg) throw new Error('Slay isn’t fully installed yet – reopen it and try again.');
  const { publicKey } = await api.get<{ publicKey: string }>('/api/security/push/key');
  let sub = await reg.pushManager.getSubscription();
  // A subscription made for a different server key can't be used: replace it.
  const key = sub?.options.applicationServerKey;
  if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api.post('/api/security/push/subscribe', sub.toJSON());
}

/**
 * On every app start: if this phone already allows notifications, make sure the server knows it
 * belongs to whoever is signed in now (after a sign-out/in, a reinstall, or a new key).
 */
export async function syncPush() {
  if ((await pushState()) === 'off' && supported() && Notification.permission === 'granted') return enablePush().catch(() => {});
  if ((await pushState()) !== 'on') return;
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await api.post('/api/security/push/subscribe', sub.toJSON()).catch(() => {});
}

export const BLOCKED_HELP = isIOS
  ? 'Notifications are blocked for Slay. Open the iPhone Settings app → Notifications → Slay, and turn on Allow Notifications.'
  : 'Notifications are blocked for Slay. Long-press the Slay icon → App info → Notifications (or tap the lock icon in Chrome’s address bar → Permissions) and allow them.';
