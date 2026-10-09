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
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  emit();
  return outcome === 'accepted';
}

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
  if (isStandalone()) {
    document.documentElement.classList.add('standalone');
    // No pinch-zooming the app itself (iOS ignores user-scalable=no).
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  if (serviceWorker && 'serviceWorker' in navigator) {
    // When a new version is installed in the background, switch to it the next time the app
    // is out of sight – never in the middle of taking an order.
    const hadController = !!navigator.serviceWorker.controller;
    let updateReady = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) updateReady = true;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && updateReady) location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // Installed apps can stay open for days: look for updates when brought back.
          document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
        })
        .catch(() => {});
    });
  }
}
