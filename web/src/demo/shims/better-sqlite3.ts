/**
 * better-sqlite3-compatible wrapper around sql.js (SQLite compiled to WebAssembly),
 * so the server's services run unchanged in the browser demo.
 */
import type { Database as SqlJsDatabase, SqlValue } from 'sql.js';

const norm = (v: unknown): SqlValue => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Uint8Array) return v;
  return v as SqlValue;
};

class Statement {
  constructor(private db: SqlJsDatabase, private sql: string) {}
  private exec<T>(params: unknown[], fn: (s: ReturnType<SqlJsDatabase['prepare']>) => T): T {
    const s = this.db.prepare(this.sql);
    try {
      if (params.length) s.bind(params.map(norm));
      return fn(s);
    } finally {
      s.free();
    }
  }
  get(...params: unknown[]) {
    return this.exec(params, (s) => (s.step() ? s.getAsObject() : undefined));
  }
  all(...params: unknown[]) {
    return this.exec(params, (s) => {
      const rows: Record<string, unknown>[] = [];
      while (s.step()) rows.push(s.getAsObject());
      return rows;
    });
  }
  run(...params: unknown[]) {
    this.exec(params, (s) => {
      while (s.step());
    });
    const changes = this.db.getRowsModified();
    const id = this.db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
    return { changes, lastInsertRowid: id };
  }
}

export default class Database {
  readonly raw: SqlJsDatabase;
  private depth = 0;

  constructor(_file: string) {
    const g = globalThis as any;
    this.raw = new g.__SLAY_SQL.Database(g.__SLAY_DB_BYTES ?? undefined);
    g.__SLAY_DB = this;
  }
  prepare(sql: string) {
    return new Statement(this.raw, sql);
  }
  exec(sql: string) {
    this.raw.exec(sql);
  }
  pragma(p: string) {
    try {
      this.raw.exec(`PRAGMA ${p}`);
    } catch {
      /* e.g. WAL is not available in memory */
    }
  }
  transaction<A extends unknown[], R>(fn: (...a: A) => R) {
    return (...args: A): R => {
      const sp = `sp${this.depth}`;
      this.raw.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const r = fn(...args);
        this.depth--;
        this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
        return r;
      } catch (e) {
        this.depth--;
        this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    };
  }
}
