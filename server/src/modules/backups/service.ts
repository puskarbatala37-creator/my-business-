import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { todayInBusinessTz } from '@slay/shared';
import type { AppContext } from '../../core/context.js';
import { service } from '../../core/context.js';
import { HttpError } from '../../core/http.js';
import { getSetting, setSetting } from '../../db/index.js';
import { migrations } from '../../db/migrations/index.js';
import type { MailService } from '../messaging/mail.js';

/** How many daily copies are kept on the server (on the permanent disk). */
export const KEEP_DAYS = 7;
/** A checked backup waits this long for "Restore" to be confirmed. */
const STAGED_MINUTES = 60;
const FILE_RE = /^slay-(\d{4}-\d{2}-\d{2})\.db$/;

/**
 * Backups of everything in the database (orders, customers, payments, stock, bills, accounts).
 *  - Once a day the server takes a full copy (safe while the app is in use) and keeps the last
 *    14 days next to the data. That guards against mistakes and a damaged database file.
 *  - Owners download a copy to their own phone / computer (More → Backups) – the off-server copy
 *    that survives losing the server itself. Slay reminds them weekly.
 * Photos are files on the server's disk and are not inside these copies.
 */
export class BackupService {
  readonly dir: string;
  constructor(private ctx: AppContext) {
    this.dir = path.join(ctx.config.dataDir, 'backups');
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => FILE_RE.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(this.dir, f));
        return { name: f, day: f.match(FILE_RE)![1], size: st.size, createdAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.day.localeCompare(a.day));
  }

  /** Full, consistent copy of the live database into `file`. */
  async copyTo(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.part`;
    await this.ctx.db.backup(tmp);
    fs.renameSync(tmp, file);
  }

  /**
   * Today's copy (taken once a day), then keep only the newest KEEP_DAYS daily copies, and email the
   * new copy to the owners. Only daily copies (slay-YYYY-MM-DD.db) are ever removed – the copies
   * kept before a restore (before-restore-….db) stay.
   */
  async daily(force = false) {
    const day = todayInBusinessTz();
    const file = path.join(this.dir, `slay-${day}.db`);
    const made = force || !fs.existsSync(file);
    if (made) await this.copyTo(file);
    for (const b of this.list().slice(KEEP_DAYS)) fs.rmSync(path.join(this.dir, b.name), { force: true });
    if (made || this.lastEmail()?.day !== day) await this.emailToOwners(file, day);
    return file;
  }

  /** Emails a daily copy (compressed) to every owner – a copy off the server, every day, automatically. */
  async emailToOwners(file: string, day: string) {
    const mail = this.ctx.services.mail as MailService | undefined;
    const owners = (this.ctx.db.prepare(`SELECT email FROM users WHERE role = 'owner' AND active = 1 AND pending = 0 AND email IS NOT NULL`).all() as { email: string }[]).map((u) => u.email);
    const record = (v: { ok: boolean; to?: string[]; error?: string }) => setSetting(this.ctx.db, 'last_backup_email', JSON.stringify({ day, at: new Date().toISOString(), ...v }));
    if (!mail?.configured) return record({ ok: false, error: 'Email is not set up on the server (SMTP_URL).' });
    if (!owners.length) return record({ ok: false, error: 'No owner has an email address.' });
    try {
      await mail.send(
        owners,
        `Slay daily backup – ${day}`,
        [
          `Attached: a full copy of the Slay data (orders, customers, payments, stock, bills, accounts) from ${day}.`,
          '',
          'Keep this email. To bring the data back: More → Backups → Restore from a backup file, then choose the attached file.',
          'Photos are not inside this file.',
        ].join('\n'),
        [{ filename: `slay-backup-${day}.db.gz`, content: zlib.gzipSync(fs.readFileSync(file)), contentType: 'application/gzip' }],
      );
      record({ ok: true, to: owners });
    } catch (e) {
      console.error('[backups] emailing the daily backup failed:', (e as Error).message);
      record({ ok: false, to: owners, error: (e as Error).message });
    }
  }

  lastEmail(): { day: string; at: string; ok: boolean; to?: string[]; error?: string } | null {
    const v = getSetting(this.ctx.db, 'last_backup_email');
    return v ? JSON.parse(v) : null;
  }

  // ── Restoring from a backup file, from the app ──

  private get stagingDir() {
    return path.join(this.ctx.config.dataDir, 'restore-check');
  }

  /**
   * Step 1 – only checks. Unpacks an uploaded backup into a holding folder, makes sure it's a
   * genuine Slay backup, and says what's inside. Nothing about the live data changes.
   */
  checkRestore(upload: Buffer) {
    fs.mkdirSync(this.stagingDir, { recursive: true });
    for (const f of fs.readdirSync(this.stagingDir)) {
      const full = path.join(this.stagingDir, f);
      if (Date.now() - fs.statSync(full).mtimeMs > STAGED_MINUTES * 60_000) fs.rmSync(full, { force: true });
    }
    let raw = upload;
    if (raw[0] === 0x1f && raw[1] === 0x8b) {
      try {
        raw = zlib.gunzipSync(raw);
      } catch {
        throw new HttpError(400, 'This file is damaged – it could not be unpacked. Try another backup.');
      }
    }
    if (raw.subarray(0, 15).toString() !== 'SQLite format 3') {
      throw new HttpError(400, 'This isn’t a Slay backup. Choose a file named like slay-backup-2026-11-01.db.gz.');
    }
    const token = crypto.randomBytes(12).toString('hex');
    const file = path.join(this.stagingDir, `${token}.db`);
    fs.writeFileSync(file, raw);
    try {
      return { token, summary: summarize(file) };
    } catch (e) {
      fs.rmSync(file, { force: true });
      throw e;
    }
  }

  /**
   * Step 2 – after the owner confirms. Hands the checked backup to the restore that runs when Slay
   * starts (it keeps the current data as before-restore-….db first), then Slay restarts.
   */
  applyRestore(token: string) {
    if (!/^[a-f0-9]{24}$/.test(token)) throw new HttpError(400, 'Choose the backup file again.');
    const staged = path.join(this.stagingDir, `${token}.db`);
    if (!fs.existsSync(staged)) throw new HttpError(410, 'That check has expired. Choose the backup file again.');
    const restoreDir = path.join(this.ctx.config.dataDir, 'restore');
    fs.mkdirSync(restoreDir, { recursive: true });
    if (fs.readdirSync(restoreDir).some((f) => /\.db(\.gz)?$/.test(f))) throw new HttpError(409, 'A restore is already waiting for Slay to restart.');
    fs.renameSync(staged, path.join(restoreDir, `restore-${todayInBusinessTz()}-${token.slice(0, 6)}.db`));
  }

  /** A fresh copy, gzip-compressed, for an owner to download. */
  async forDownload(userId: number) {
    const tmp = path.join(this.dir, `download-${process.pid}-${Date.now()}.db`);
    await this.copyTo(tmp);
    try {
      const data = zlib.gzipSync(fs.readFileSync(tmp));
      setSetting(this.ctx.db, 'last_backup_download', JSON.stringify({ at: new Date().toISOString(), by: userId }));
      return data;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  lastDownload(): { at: string; by: number } | null {
    const v = getSetting(this.ctx.db, 'last_backup_download');
    return v ? JSON.parse(v) : null;
  }
}

/**
 * Restoring: put a backup (slay-….db or a downloaded slay-backup-….db.gz) into DATA_DIR/restore and
 * restart Slay. Before opening the database, it is swapped in; the data it replaces is kept in
 * DATA_DIR/backups/before-restore-<time>.db. Runs before anything else touches the database.
 */
export function restoreIfRequested(dataDir: string, dbFile: string): string | null {
  const dir = path.join(dataDir, 'restore');
  if (!fs.existsSync(dir)) return null;
  const file = fs.readdirSync(dir).find((f) => /\.db(\.gz)?$/.test(f));
  if (!file) return null;
  const src = path.join(dir, file);
  const raw = file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(src)) : fs.readFileSync(src);
  if (raw.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error(`${file} is not a Slay backup – nothing was restored.`);
  if (fs.existsSync(dbFile)) {
    const keep = path.join(dataDir, 'backups', `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    fs.copyFileSync(dbFile, keep);
  }
  for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
  fs.writeFileSync(dbFile, raw);
  fs.rmSync(src);
  return file;
}


/** What's inside a backup – read-only, and refused if it isn't a Slay database this version understands. */
export function summarize(file: string) {
  let db: Database.Database;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    throw new HttpError(400, 'This backup file is damaged and can’t be read.');
  }
  try {
    const tables = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name));
    if (!['users', 'orders', 'customers', 'schema_migrations'].every((t) => tables.has(t))) {
      throw new HttpError(400, 'This file is a database, but not a Slay backup – nothing was changed.');
    }
    const known = new Set(migrations.map((m) => m.id));
    const unknown = (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).filter((m) => !known.has(m.id));
    if (unknown.length) throw new HttpError(400, 'This backup was made by a newer version of Slay. Update Slay first, then restore it.');
    const n = (sql: string) => (tables.has(sql.split(' FROM ')[1].split(' ')[0]) ? ((db.prepare(sql).get() as { n: number | null }).n ?? 0) : 0);
    const last = db.prepare('SELECT MAX(order_date) AS d FROM orders').get() as { d: string | null };
    const latest = db.prepare(`SELECT MAX(x) AS t FROM (SELECT MAX(created_at) AS x FROM orders UNION ALL SELECT MAX(updated_at) FROM orders)`).get() as { t: string | null };
    return {
      accounts: n('SELECT COUNT(*) AS n FROM users'),
      orders: n('SELECT COUNT(*) AS n FROM orders'),
      cancelled: n(`SELECT COUNT(*) AS n FROM orders WHERE state = 'cancelled'`),
      customers: n('SELECT COUNT(*) AS n FROM customers'),
      products: n('SELECT COUNT(*) AS n FROM products'),
      bills: n('SELECT COUNT(*) AS n FROM receipts'),
      owners: (db.prepare(`SELECT display_name AS name, COALESCE(email, username) AS email FROM users WHERE role = 'owner' ORDER BY id`).all() as { name: string; email: string }[]),
      lastOrderDate: last.d,
      lastChange: latest.t,
    };
  } finally {
    db.close();
  }
}
