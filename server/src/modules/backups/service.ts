import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { todayInBusinessTz } from '@slay/shared';
import type { AppContext } from '../../core/context.js';
import { getSetting, setSetting } from '../../db/index.js';

/** How many daily copies are kept on the server. */
export const KEEP_DAYS = 14;
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

  /** Today's copy (taken once a day), then drop copies older than KEEP_DAYS. */
  async daily(force = false) {
    const day = todayInBusinessTz();
    const file = path.join(this.dir, `slay-${day}.db`);
    if (force || !fs.existsSync(file)) await this.copyTo(file);
    for (const b of this.list().slice(KEEP_DAYS)) fs.rmSync(path.join(this.dir, b.name), { force: true });
    return file;
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
