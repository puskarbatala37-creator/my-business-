import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';

/**
 * Keeps a copy of recently viewed screens (orders, stock, customers, dashboard…) on the phone,
 * so Slay opens instantly and still shows them with no internet. Saved for the signed-in person
 * only and wiped on sign-out; anything changed while offline is never queued – stock must be
 * checked live so nothing gets sold twice.
 */
const DB = 'slay-offline';
const STORE = 'cache';
const KEY = 'queries';
const MAX_AGE = 14 * 24 * 60 * 60 * 1000;
/** Bump when the shape of saved data changes. */
const BUSTER = 'v1';

interface Saved {
  buster: string;
  savedAt: number;
  userId: number | null;
  state: DehydratedState;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

const meId = (qc: QueryClient) => (qc.getQueryData<{ user?: { id: number } } | null>(['me']) ?? null)?.user?.id ?? null;

/** Restores the saved screens (if any) – call before the app first renders. */
export async function restoreQueries(qc: QueryClient) {
  try {
    const saved = await tx<Saved | undefined>('readonly', (s) => s.get(KEY));
    if (!saved || saved.buster !== BUSTER || Date.now() - saved.savedAt > MAX_AGE || !saved.userId) return;
    hydrate(qc, saved.state);
    // Saved screens show at once but are always re-checked when opened (also the sign-in): the copy
    // may be from just before a change – e.g. made on the other phone, or the last save didn't finish.
    qc.invalidateQueries({ refetchType: 'none' });
  } catch {
    /* private mode / storage blocked: just start empty */
  }
}

/** Saves the cache shortly after it changes, for as long as someone is signed in. */
export function persistQueries(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    timer = undefined;
    const userId = meId(qc);
    if (!userId) return;
    const state = dehydrate(qc, {
      shouldDehydrateQuery: (q) => q.state.status === 'success' && q.state.data !== undefined,
    });
    const value: Saved = { buster: BUSTER, savedAt: Date.now(), userId, state };
    tx('readwrite', (s) => s.put(value, KEY)).catch(() => {});
  };
  qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || e.action.type !== 'success') return;
    if (!timer) timer = setTimeout(save, 1000);
  });
  // Save immediately when the app is closed or switched away from.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer);
      save();
    }
  });
}

/** Removes everything saved on this phone (sign-out, or the session ended). */
export async function clearSavedQueries() {
  try {
    await tx('readwrite', (s) => s.delete(KEY));
  } catch {}
}
