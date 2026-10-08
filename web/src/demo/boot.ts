/**
 * Demo preview boot: loads SQLite (WebAssembly), restores the saved demo database
 * from this browser, then starts the in-browser server before the app renders.
 */
import { Buffer } from 'buffer';
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

/**
 * The SQLite WebAssembly is embedded in the script as a data: URL. Hosted previews block
 * fetch()/XHR of data: URLs (their Content-Security-Policy), which is how sql.js normally
 * loads it – so decode the bytes ourselves and hand them over directly.
 */
async function wasmBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith('data:')) {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the database engine (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** SQLite: WebAssembly where allowed; otherwise the plain-JavaScript build (for hosts that block WebAssembly). */
/** True when this page may run WebAssembly (some hosts' security policy forbids compiling it). */
function webAssemblyAllowed() {
  try {
    // The smallest valid module: magic number + version.
    new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    return true;
  } catch {
    return false;
  }
}

async function loadSqlite() {
  try {
    if (!webAssemblyAllowed()) throw new Error('WebAssembly is blocked on this page');
    const wasmBinary = await wasmBytes(wasmUrl);
    return await initSqlJs({ wasmBinary: wasmBinary.buffer as ArrayBuffer, locateFile: () => wasmUrl });
  } catch (err) {
    console.info('[demo] Using the JavaScript build of SQLite:', (err as Error).message);
    const mod: any = await import('sql.js/dist/sql-asm.js');
    const initAsm = (mod.default ?? mod) as typeof initSqlJs;
    return await initAsm();
  }
}

export async function bootDemo() {
  const SQL = await loadSqlite();
  const g = globalThis as any;
  // Server code uses Node's global Buffer (recovery codes, eSewa); browsers don't have one.
  g.Buffer ??= Buffer;
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
