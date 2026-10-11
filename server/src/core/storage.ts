import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.js';

/**
 * Is Slay's data really on a permanent disk? On hosts like Render the app's own files are wiped on
 * every deploy and restart – only an attached disk survives. If the data folder isn't on that disk,
 * every deploy starts with an empty database (and asks for a new setup code), so this is checked on
 * every start, written to the server log, and shown in the app.
 */
export interface StorageReport {
  dataDir: string;
  /** true = on its own disk, false = on the container's temporary files, null = can't tell (not Linux). */
  permanent: boolean | null;
  /** The disk the data folder is on, e.g. "/data (ext4)". */
  mount: string | null;
  /** Other permanent disks attached to this server – e.g. one mounted at a different path by mistake. */
  otherDisks: string[];
  /** When this database was first created (its first migration). */
  createdAt: string | null;
  accounts: number;
  orders: number;
}

interface Mount {
  point: string;
  type: string;
  /** Mount options, e.g. "rw,relatime". */
  options?: string;
}

const DISK_TYPES = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'nfs', 'nfs4', 'fuse.juicefs', 'ceph']);
const SYSTEM_POINTS = /^\/(proc|sys|dev|run|etc|tmp)(\/|$)/;

function readMounts(): Mount[] | null {
  try {
    return fs
      .readFileSync('/proc/self/mounts', 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [, point, type, options] = l.split(' ');
        return { point: point.replace(/\\040/g, ' '), type, options };
      });
  } catch {
    return null; // not Linux (e.g. a laptop during development)
  }
}

/**
 * `ephemeralRoot`: the server's own drive ("/") is wiped on every deploy – true on Render and in
 * containers (overlay file system); false on an ordinary server where "/" is a real disk.
 */
export function storageReport(db: DB, dataDir: string, mounts: Mount[] | null = readMounts(), ephemeralRoot = !!process.env.RENDER): StorageReport {
  const dir = path.resolve(dataDir);
  let permanent: boolean | null = null;
  let mount: string | null = null;
  let otherDisks: string[] = [];
  if (mounts) {
    // The mount the data folder lives on = the longest mount point that contains it.
    const own = mounts.filter((m) => dir === m.point || dir.startsWith(m.point.endsWith('/') ? m.point : `${m.point}/`)).sort((a, b) => b.point.length - a.point.length)[0];
    const rootIsTemporary = ephemeralRoot || !DISK_TYPES.has(mounts.find((m) => m.point === '/')?.type ?? '');
    permanent = !!own && DISK_TYPES.has(own.type) && (own.point !== '/' || !rootIsTemporary);
    mount = own ? `${own.point} (${own.type})` : null;
    // Writable data disks elsewhere – only worth naming when the data isn't on one.
    otherDisks = permanent
      ? []
      : mounts
          .filter((m) => m !== own && m.point !== '/' && DISK_TYPES.has(m.type) && !SYSTEM_POINTS.test(m.point) && !/(^|,)ro(,|$)/.test(m.options ?? ''))
          .map((m) => m.point);
  }
  const count = (sql: string) => {
    try {
      return (db.prepare(sql).get() as { n: number }).n;
    } catch {
      return 0;
    }
  };
  const created = db.prepare(`SELECT applied_at FROM schema_migrations WHERE id = '001_init'`).get() as { applied_at: string } | undefined;
  return {
    dataDir: dir,
    permanent,
    mount,
    otherDisks,
    createdAt: created?.applied_at ?? null,
    accounts: count('SELECT COUNT(*) AS n FROM users'),
    orders: count('SELECT COUNT(*) AS n FROM orders'),
  };
}

/** Plain-language lines for the server log (and the warning shown in the app). */
export function storageLines(r: StorageReport): { ok: boolean; lines: string[] } {
  const lines = [`[storage] Data folder: ${r.dataDir}${r.mount ? ` – on ${r.mount}` : ''}`];
  lines.push(`[storage] Database first created ${r.createdAt ?? 'just now'} · ${r.accounts} account${r.accounts === 1 ? '' : 's'}, ${r.orders} order${r.orders === 1 ? '' : 's'}`);
  if (r.permanent === false) {
    lines.push('[storage] ✗ WARNING: the data folder is NOT on a permanent disk. Everything (accounts, orders, photos) is lost on the next deploy or restart.');
    if (r.otherDisks.length) {
      lines.push(`[storage]   A permanent disk IS attached at: ${r.otherDisks.join(', ')}. Fix: change the disk's mount path to ${r.dataDir}, or set the environment variable DATA_DIR=${r.otherDisks[0]}.`);
    } else {
      lines.push(`[storage]   No permanent disk is attached. Fix: add a disk with mount path ${r.dataDir} (Render: service → Disks; needs a paid instance).`);
    }
  } else if (r.permanent) lines.push('[storage] ✓ Data is on a permanent disk – it is kept across deploys and restarts.');
  return { ok: r.permanent !== false, lines };
}
