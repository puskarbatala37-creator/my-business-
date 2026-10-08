/**
 * Demo preview boot: loads SQLite (WebAssembly), restores the saved demo database
 * from this browser, then starts the in-browser server before the app renders.
 */
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

const STORE = 'slay-demo';

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(STORE, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('db');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function load(): Promise<Uint8Array | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    const r = db.transaction('db').objectStore('db').get('bytes');
    r.onsuccess = () => resolve((r.result as Uint8Array) ?? null);
    r.onerror = () => resolve(null);
  });
}

async function save(bytes: Uint8Array) {
  const db = await idb();
  if (!db) return;
  db.transaction('db', 'readwrite').objectStore('db').put(bytes, 'bytes');
}

export async function resetDemo() {
  const db = await idb();
  if (db) await new Promise((r) => (db.transaction('db', 'readwrite').objectStore('db').delete('bytes').onsuccess = r));
  try {
    localStorage.removeItem('slay.demo.session');
  } catch {}
  location.reload();
}

export async function bootDemo() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const g = globalThis as any;
  g.__SLAY_SQL = SQL;
  g.__SLAY_DB_BYTES = await load();
  const { startDemoServer } = await import('./server');
  let timer: ReturnType<typeof setTimeout> | undefined;
  await startDemoServer(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const raw = g.__SLAY_DB.raw;
      void save(raw.export());
      // export() resets connection settings – turn foreign keys back on.
      raw.exec('PRAGMA foreign_keys = ON');
    }, 400);
  });
}
