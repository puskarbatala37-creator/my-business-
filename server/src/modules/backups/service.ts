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
import type { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DB_ENTRY, photoFiles, unpackBackupZip, writeBackupZip, ZIP_MAGIC } from './archive.js';
import type { MailService } from '../messaging/mail.js';

/** How many daily copies are kept on the server (on the permanent disk). */
export const KEEP_DAYS = 7;
/** A checked backup waits this long for "Restore" to be confirmed. */
const STAGED_MINUTES = 60;
/** Daily emails attach the backup with photos only below this size. */
export const EMAIL_LIMIT = 20 * 1024 * 1024;
/** More → Backups warns from this much disk use; owners are notified from DISK_ALERT_PCT. */
export const DISK_WARN_PCT = 80;
const DISK_ALERT_PCT = 90;
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
  readonly photosDir: string;
  constructor(private ctx: AppContext) {
    this.dir = path.join(ctx.config.dataDir, 'backups');
    this.photosDir = ctx.config.uploadsDir;
  }

  /** The daily copies, newest first: the database file, and (from now on) a folder of that day's photos. */
  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => FILE_RE.test(f))
      .map((f) => {
        const day = f.match(FILE_RE)![1];
        const st = fs.statSync(path.join(this.dir, f));
        const photos = path.join(this.dir, `photos-${day}`);
        return { name: f, day, size: st.size, createdAt: st.mtime.toISOString(), photos: fs.existsSync(photos) ? photoFiles(photos).length : null };
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
   * That day's photos, in backups/photos-<day>/. Photos never change once uploaded, so each file is
   * hard-linked, not copied: a photo takes disk space once however many daily copies include it
   * (and stays in the copies even if it's later removed from Slay).
   */
  snapshotPhotos(day: string) {
    const dest = path.join(this.dir, `photos-${day}`);
    const tmp = `${dest}.part`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const f of photoFiles(this.photosDir)) {
      const from = path.join(this.photosDir, f);
      try {
        fs.linkSync(from, path.join(tmp, f));
      } catch {
        fs.copyFileSync(from, path.join(tmp, f)); // e.g. a disk that can't link: a plain copy
      }
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    return dest;
  }

  /**
   * Today's copy (database + photos, taken once a day), then keep only the newest KEEP_DAYS daily
   * copies, email the new copy to the owners, and check the disk. Only daily copies (slay-<day>.db,
   * photos-<day>/) are ever removed – the copies kept before a restore stay.
   */
  async daily(force = false) {
    const day = todayInBusinessTz();
    const file = path.join(this.dir, `slay-${day}.db`);
    const made = force || !fs.existsSync(file);
    if (made) await this.copyTo(file);
    if (made || !fs.existsSync(path.join(this.dir, `photos-${day}`))) this.snapshotPhotos(day);
    const keep = new Set(this.list().slice(0, KEEP_DAYS).map((b) => b.day));
    for (const f of fs.readdirSync(this.dir)) {
      const m = f.match(/^(?:slay-(\d{4}-\d{2}-\d{2})\.db|photos-(\d{4}-\d{2}-\d{2}))$/);
      if (m && !keep.has(m[1] ?? m[2])) fs.rmSync(path.join(this.dir, f), { recursive: true, force: true });
    }
    if (made || this.lastEmail()?.day !== day) await this.emailToOwners(file, day);
    this.checkDisk();
    return file;
  }

  /** A fresh, complete copy for an owner to download: one zip with the database and every photo. */
  async streamDownload(out: Writable, userId: number) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = path.join(this.dir, `download-${process.pid}-${Date.now()}.db`);
    await this.copyTo(tmp);
    try {
      const r = await writeBackupZip(out, tmp, this.photosDir, { created: new Date().toISOString() });
      setSetting(this.ctx.db, 'last_backup_download', JSON.stringify({ at: new Date().toISOString(), by: userId, photos: r.photos }));
      return r;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  lastDownload(): { at: string; by: number } | null {
    const v = getSetting(this.ctx.db, 'last_backup_download');
    return v ? JSON.parse(v) : null;
  }

  /**
   * Emails a daily copy to every owner: database + photos as one zip when it's under 20 MB,
   * otherwise only the database (and the email says the photos are in the manual backup).
   */
  async emailToOwners(file: string, day: string) {
    const mail = this.ctx.services.mail as MailService | undefined;
    const owners = (this.ctx.db.prepare(`SELECT email FROM users WHERE role = 'owner' AND active = 1 AND pending = 0 AND email IS NOT NULL`).all() as { email: string }[]).map((u) => u.email);
    const record = (v: { ok: boolean; to?: string[]; error?: string; photos?: boolean }) => setSetting(this.ctx.db, 'last_backup_email', JSON.stringify({ day, at: new Date().toISOString(), ...v }));
    if (!mail?.configured) return record({ ok: false, error: 'Email is not set up on the server (SMTP_URL).' });
    if (!owners.length) return record({ ok: false, error: 'No owner has an email address.' });
    const photosDir = fs.existsSync(path.join(this.dir, `photos-${day}`)) ? path.join(this.dir, `photos-${day}`) : this.photosDir;
    const zipFile = path.join(this.dir, `email-${process.pid}-${Date.now()}.zip`);
    try {
      const z = await writeBackupZip(fs.createWriteStream(zipFile), file, photosDir, { created: new Date().toISOString(), day });
      const withPhotos = fs.statSync(zipFile).size < EMAIL_LIMIT;
      const attachment = withPhotos
        ? { filename: `slay-backup-${day}.zip`, content: fs.readFileSync(zipFile), contentType: 'application/zip' }
        : { filename: `slay-backup-${day}.db.gz`, content: zlib.gzipSync(fs.readFileSync(file)), contentType: 'application/gzip' };
      await mail.send(
        owners,
        `Slay daily backup – ${day}`,
        [
          withPhotos
            ? `Attached: a full copy of Slay from ${day} – orders, customers, payments, stock, bills, accounts and all ${z.photos} photos.`
            : `Attached: the Slay data from ${day} – orders, customers, payments, stock, bills and accounts.`,
          ...(withPhotos
            ? []
            : ['', `The ${z.photos} photos together are over 20 MB, too big for email, so they're not attached. They're in the manual backup: More → Backups → Save a backup now (one zip with the data and every photo).`]),
          '',
          'Keep this email. To bring the data back: More → Backups → Restore from a backup file, then choose the attached file.',
        ].join('\n'),
        [attachment],
      );
      record({ ok: true, to: owners, photos: withPhotos });
    } catch (e) {
      console.error('[backups] emailing the daily backup failed:', (e as Error).message);
      record({ ok: false, to: owners, error: (e as Error).message });
    } finally {
      fs.rmSync(zipFile, { force: true });
    }
  }

  lastEmail(): { day: string; at: string; ok: boolean; to?: string[]; error?: string; photos?: boolean } | null {
    const v = getSetting(this.ctx.db, 'last_backup_email');
    return v ? JSON.parse(v) : null;
  }

  /** How full the disk is, and what takes the space (a photo shared by several daily copies counts once). */
  disk() {
    const seen = new Set<string>();
    const sizeOf = (dir: string): number => {
      if (!fs.existsSync(dir)) return 0;
      let n = 0;
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) n += sizeOf(full);
        else if (d.isFile()) {
          const st = fs.statSync(full);
          const id = `${st.dev}:${st.ino}`;
          if (!seen.has(id)) (seen.add(id), (n += st.size));
        }
      }
      return n;
    };
    const photos = sizeOf(this.photosDir);
    const backups = sizeOf(this.dir); // photos already counted above aren't counted again
    let total: number | null = null;
    let free: number | null = null;
    try {
      const st = fs.statfsSync(this.ctx.config.dataDir);
      total = st.blocks * st.bsize;
      free = st.bavail * st.bsize;
    } catch {}
    const usedPct = total && free !== null ? Math.round(((total - free) / total) * 100) : null;
    return { total, free, usedPct, photos, backups, database: fs.existsSync(this.ctx.config.dbFile) ? fs.statSync(this.ctx.config.dbFile).size : 0, warn: usedPct !== null && usedPct >= DISK_WARN_PCT };
  }

  /** Owners are notified (at most once a day) when the disk is nearly full. */
  checkDisk() {
    const d = this.disk();
    if (d.usedPct !== null && d.usedPct >= DISK_ALERT_PCT) {
      const alerts = this.ctx.services.alerts as { raiseOnce: (k: string, m: number, kind: string, s: 'warning', msg: string) => unknown } | undefined;
      alerts?.raiseOnce('disk_full', 24 * 60, 'disk_nearly_full', 'warning', `Slay's server disk is ${d.usedPct}% full. Make the disk bigger (Render → Disks) before it runs out – see More → Backups.`);
    }
    return d;
  }

  // ── Restoring from a backup file, from the app ──

  private get stagingDir() {
    return path.join(this.ctx.config.dataDir, 'restore-check');
  }

  /**
   * Step 1 – only checks. Saves the upload to a holding folder, unpacks it (a .zip with photos, or an
   * older .db.gz / .db with only the data), makes sure it's a genuine Slay backup and says what's
   * inside. Nothing about the live data changes.
   */
  async checkRestore(upload: Readable) {
    fs.mkdirSync(this.stagingDir, { recursive: true });
    for (const f of fs.readdirSync(this.stagingDir)) {
      const full = path.join(this.stagingDir, f);
      if (Date.now() - fs.statSync(full).mtimeMs > STAGED_MINUTES * 60_000) fs.rmSync(full, { recursive: true, force: true });
    }
    const token = crypto.randomBytes(12).toString('hex');
    const dir = path.join(this.stagingDir, token);
    const received = `${dir}.upload`;
    fs.mkdirSync(dir, { recursive: true });
    try {
      await pipeline(upload, fs.createWriteStream(received));
      if (!fs.statSync(received).size) throw new HttpError(400, 'Choose a backup file first.');
      const head = Buffer.alloc(16);
      const fd = fs.openSync(received, 'r');
      fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      const db = path.join(dir, DB_ENTRY);
      let photos = 0;
      if (head.subarray(0, 4).equals(ZIP_MAGIC)) {
        let unpacked;
        try {
          unpacked = await unpackBackupZip(received, dir);
        } catch {
          throw new HttpError(400, 'This zip file is damaged – it could not be unpacked. Try another backup.');
        }
        if (!unpacked.hasDb) throw new HttpError(400, 'This zip isn’t a Slay backup (there’s no slay.db inside).');
        photos = unpacked.photos;
      } else if (head[0] === 0x1f && head[1] === 0x8b) {
        try {
          await pipeline(fs.createReadStream(received), zlib.createGunzip(), fs.createWriteStream(db));
        } catch {
          throw new HttpError(400, 'This file is damaged – it could not be unpacked. Try another backup.');
        }
      } else fs.renameSync(received, db);
      const start = Buffer.alloc(15);
      const fd2 = fs.openSync(db, 'r');
      fs.readSync(fd2, start, 0, 15, 0);
      fs.closeSync(fd2);
      if (start.toString() !== 'SQLite format 3') throw new HttpError(400, 'This isn’t a Slay backup. Choose a file named like slay-backup-2026-11-01.zip (or an older .db.gz).');
      return { token, summary: { ...summarize(db), photos } };
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOSPC') throw new HttpError(507, 'There isn’t enough free space on the server disk to check this backup. Make the disk bigger (Render → Disks) and try again.');
      throw e;
    } finally {
      fs.rmSync(received, { force: true });
    }
  }

  /**
   * Step 2 – after the owner confirms. Hands the checked backup to the restore that runs when Slay
   * starts (it keeps the current data as before-restore-….db and adds the photos), then Slay restarts.
   */
  applyRestore(token: string) {
    if (!/^[a-f0-9]{24}$/.test(token)) throw new HttpError(400, 'Choose the backup file again.');
    const staged = path.join(this.stagingDir, token);
    if (!fs.existsSync(path.join(staged, DB_ENTRY))) throw new HttpError(410, 'That check has expired. Choose the backup file again.');
    const restoreDir = path.join(this.ctx.config.dataDir, 'restore');
    fs.mkdirSync(restoreDir, { recursive: true });
    if (fs.readdirSync(restoreDir).length) throw new HttpError(409, 'A restore is already waiting for Slay to restart.');
    fs.renameSync(staged, path.join(restoreDir, `restore-${todayInBusinessTz()}-${token.slice(0, 6)}`));
  }
}

/**
 * Restoring on start: a backup waiting in DATA_DIR/restore – a folder from the app (slay.db and
 * uploads/), or a slay-….db / slay-backup-….db.gz put there by hand – is swapped in before anything
 * opens the database. The current data is kept first as backups/before-restore-<time>.db. Photos
 * from the backup are added to the photos folder; photos already there are never replaced or removed.
 */
export function restoreIfRequested(dataDir: string, dbFile: string, uploadsDir = path.join(dataDir, 'uploads')): string | null {
  const dir = path.join(dataDir, 'restore');
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir);
  const folder = entries.find((f) => fs.statSync(path.join(dir, f)).isDirectory() && fs.existsSync(path.join(dir, f, DB_ENTRY)));
  const file = folder ?? entries.find((f) => /\.db(\.gz)?$/.test(f));
  if (!file) return null;
  const src = path.join(dir, file);
  const dbSrc = folder ? path.join(src, DB_ENTRY) : src;
  const raw = dbSrc.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(dbSrc)) : fs.readFileSync(dbSrc);
  if (raw.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error(`${file} is not a Slay backup – nothing was restored.`);
  if (fs.existsSync(dbFile)) {
    // Fold the latest changes (still in the -wal file) into the database first, so the copy kept is complete.
    try {
      const old = new Database(dbFile);
      old.pragma('wal_checkpoint(TRUNCATE)');
      old.close();
    } catch {}
    const keep = path.join(dataDir, 'backups', `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    fs.copyFileSync(dbFile, keep);
  }
  for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
  fs.writeFileSync(dbFile, raw);
  let added = 0;
  if (folder) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    for (const p of photoFiles(path.join(src, 'uploads'))) {
      const to = path.join(uploadsDir, p);
      if (fs.existsSync(to)) continue; // never replace a photo that's already there
      fs.renameSync(path.join(src, 'uploads', p), to);
      added++;
    }
  }
  fs.rmSync(src, { recursive: true, force: true });
  return folder ? `${file} (with ${added} photo${added === 1 ? '' : 's'})` : file;
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
