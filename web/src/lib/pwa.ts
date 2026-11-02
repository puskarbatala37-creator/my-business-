/**
 * Everything that makes Slay behave like an installed phone app: launch screen, install prompt,
 * service worker updates, and native touch behaviour.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
/** iPhone/iPad (iPadOS reports itself as a Mac with a touch screen). */
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(ua);
/** Opened inside Instagram/Facebook/TikTok/Messenger etc. – those can't install apps. */
export const inAppBrowser = /FBAN|FBAV|FB_IAB|Instagram|musical_ly|TikTok|BytedanceWebview|Line\/|Snapchat|WhatsApp/i.test(ua);
/** iOS browser other than Safari (Chrome, Edge, Firefox on iPhone). */
export const iosOtherBrowser = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

/** iPad (including iPadOS, which reports itself as a Mac with a touch screen). */
export const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);

/**
 * iOS version, e.g. 18.1 – from Safari's "Version/18.1" (the reliable one: iOS 26 still reports
 * "OS 18_6" in the system part) or else the "OS 17_4" part. Null when not iOS.
 */
export function iosVersion(agent = ua): number | null {
  if (!/iPhone|iPad|iPod|Macintosh/.test(agent)) return null;
  const v = agent.match(/Version\/(\d+)(?:\.(\d+))?/) ?? agent.match(/OS (\d+)_(\d+)/);
  return v ? Number(`${v[1]}.${v[2] ?? 0}`) : null;
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Whether the browser offers a one-tap install (Android Chrome, desktop Chrome/Edge). */
export const canPromptInstall = () => !!deferred;
export function onInstallChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
/**
 * Opens the browser's own install window. `unavailable`: the browser refused to show it (it only
 * allows one per page load, and can decide not to offer it) – the manual steps are the way then.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  deferred = null; // the browser allows each install offer to be used once
  emit();
  if (!e) return 'unavailable';
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}

/** Installed from this browser before (the browser told us), though this tab isn't the installed app. */
export function installedBefore() {
  try {
    return localStorage.getItem('slay.installed') === '1';
  } catch {
    return false;
  }
}

// ── "New version available" ──
let updateReady = false;
const updateSubs = new Set<() => void>();
/** True once a newer version of Slay has taken over while this screen was still the old one. */
export const updateAvailable = () => updateReady;
export function onUpdateAvailable(fn: () => void) {
  updateSubs.add(fn);
  return () => void updateSubs.delete(fn);
}
/** Load the new version now. */
export const applyUpdate = () => location.reload();

/** Fades out the launch screen once the first real screen is ready. */
export function hideSplash() {
  const el = document.getElementById('splash');
  if (!el || el.classList.contains('hide')) return;
  el.classList.add('hide');
  setTimeout(() => el.remove(), 400);
}

/** Wipes this person's saved data from the phone (on sign-out). */
export function clearOfflinePhotos() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'clear-user-data' });
}

export function initPwa({ serviceWorker }: { serviceWorker: boolean }) {
  // Must be caught as early as possible – the browser fires it once, shortly after load.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    try {
      localStorage.setItem('slay.installed', '1');
    } catch {}
    emit();
  });

  // iOS only shows :active (press) styles when the page listens for touches.
  document.addEventListener('touchstart', () => {}, { passive: true });
  if (isStandalone()) document.documentElement.classList.add('standalone');
  // No pinch-zooming the whole page – also in Safari, which ignores user-scalable=no: a zoomed-in
  // screen (e.g. a bill's amount) could otherwise get stuck. Photos zoom in the photo viewer instead.
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  if (serviceWorker && 'serviceWorker' in navigator) {
    // A new version of Slay is downloaded in the background. When it takes over while the app is
    // open, say so ("New version available – tap to update") – only then, never on a first install
    // or an ordinary open. If nobody taps, it switches over the next time the app is out of sight.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || updateReady) return;
      updateReady = true;
      updateSubs.forEach((f) => f());
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && updateReady) location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          const check = () => reg.update().catch(() => {});
          // Installed apps can stay open for days: look for a new version when brought back, and every 30 minutes.
          document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
          setInterval(check, 30 * 60 * 1000);
        })
        .catch(() => {});
    });
  }
}
