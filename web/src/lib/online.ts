import { useSyncExternalStore } from 'react';

/**
 * Whether Slay can reach the server right now. Combines the phone's own signal with what
 * actually happens to requests (phones often report "online" on a dead Wi-Fi).
 */
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
const listeners = new Set<() => void>();
function set(v: boolean) {
  if (v === online) return;
  online = v;
  listeners.forEach((l) => l());
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => set(true));
  window.addEventListener('offline', () => set(false));
}
/** Called by the API client after every request. */
export const reportNetwork = (ok: boolean) => set(ok);

export function useOnline() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => online,
  );
}
