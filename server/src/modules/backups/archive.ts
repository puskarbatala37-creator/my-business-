import fs from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

/**
 * Backup zip files: `slay.db` (the database), `uploads/<file>` (every photo) and `slay-backup.json`
 * (what's inside). Written as a stream – photos are never all held in memory – and read back the
 * same way. Photos are already-compressed JPEGs, so they're stored as they are; the database is
 * compressed.
 */
export const DB_ENTRY = 'slay.db';
export const MANIFEST_ENTRY = 'slay-backup.json';
const PHOTO_ENTRY = /^uploads\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$/;

export const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Photo files in a folder (only plain file names – the way Slay names its uploads). */
export function photoFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && PHOTO_ENTRY.test(`uploads/${d.name}`))
    .map((d) => d.name)
    .sort();
}

/**
 * Writes a backup zip to `out` (a download, or a file). Waits for the receiver to keep up, so even
 * a large photo collection streams through without filling the server's memory.
 */
export async function writeBackupZip(out: Writable, dbFile: string, photosDir: string, meta: Record<string, unknown>): Promise<{ photos: number; bytes: number }> {
  const photos = photoFiles(photosDir);
  let bytes = 0;
  let failed: Error | null = null;
  const done = new Promise<void>((resolve, reject) => {
    const zip = new Zip((err, chunk, final) => {
      if (err) return reject((failed = err));
      bytes += chunk.length;
      out.write(Buffer.from(chunk));
      if (final) {
        out.end();
        out.once('finish', resolve);
        out.once('close', resolve);
      }
    });
    (async () => {
      const add = async (name: string, file: string, compress: boolean) => {
        const entry = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
        zip.add(entry);
        for await (const chunk of fs.createReadStream(file)) {
          if (failed) throw failed;
          entry.push(chunk as Buffer);
          if (out.writableNeedDrain) await new Promise((r) => out.once('drain', r));
        }
        entry.push(new Uint8Array(0), true);
      };
      const manifest = new ZipDeflate(MANIFEST_ENTRY);
      zip.add(manifest);
      manifest.push(Buffer.from(JSON.stringify({ app: 'slay', version: 1, photos: photos.length, ...meta }, null, 2)), true);
      await add(DB_ENTRY, dbFile, true);
      for (const p of photos) await add(`uploads/${p}`, path.join(photosDir, p), false);
      zip.end();
    })().catch(reject);
  });
  await done;
  return { photos: photos.length, bytes };
}

/**
 * Unpacks a backup zip into `dest` (`dest/slay.db`, `dest/uploads/…`). Anything else in the zip is
 * ignored – nothing can be written outside `dest`. Returns how many photos were found.
 */
export async function unpackBackupZip(zipFile: string, dest: string): Promise<{ hasDb: boolean; photos: number; manifest: Record<string, unknown> | null }> {
  fs.mkdirSync(path.join(dest, 'uploads'), { recursive: true });
  const writes: Promise<void>[] = [];
  let hasDb = false;
  let photos = 0;
  let manifestText = '';
  let error: Error | null = null;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    const photo = file.name.match(PHOTO_ENTRY);
    let target: string | null = null;
    if (file.name === DB_ENTRY) (target = path.join(dest, DB_ENTRY)), (hasDb = true);
    else if (photo) (target = path.join(dest, 'uploads', photo[1])), photos++;
    if (file.name === MANIFEST_ENTRY) {
      file.ondata = (err, data) => {
        if (err) error = err;
        else manifestText += Buffer.from(data).toString('utf8');
      };
      file.start();
      return;
    }
    if (!target) return; // not part of a Slay backup: skipped
    const ws = fs.createWriteStream(target);
    writes.push(
      new Promise((resolve, reject) => {
        ws.once('finish', resolve);
        ws.once('error', reject);
      }),
    );
    file.ondata = (err, data, final) => {
      if (err) {
        error = err;
        ws.destroy(err);
        return;
      }
      ws.write(Buffer.from(data));
      if (final) ws.end();
    };
    file.start();
  };
  for await (const chunk of fs.createReadStream(zipFile)) {
    unzip.push(chunk as Buffer);
    if (error) break;
  }
  if (!error) unzip.push(new Uint8Array(0), true);
  await Promise.all(writes);
  if (error) throw error;
  let manifest: Record<string, unknown> | null = null;
  try {
    manifest = manifestText ? JSON.parse(manifestText) : null;
  } catch {}
  return { hasDb, photos, manifest };
}
