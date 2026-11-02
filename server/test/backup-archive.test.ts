import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { unpackBackupZip, writeBackupZip } from '../src/modules/backups/archive.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'slay-zip-'));

describe('backup zip files', () => {
  it('round trip: the database and every photo come back byte for byte', async () => {
    const src = tmp();
    const db = path.join(src, 'slay.db');
    fs.writeFileSync(db, Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(50_000)]));
    const photos = path.join(src, 'uploads');
    fs.mkdirSync(photos);
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < 5; i++) {
      const name = `m${i}-abcdef0123456789.jpg`;
      files[name] = crypto.randomBytes(300_000 + i);
      fs.writeFileSync(path.join(photos, name), files[name]);
    }
    fs.writeFileSync(path.join(photos, '.hidden'), 'skip me');
    const zipFile = path.join(src, 'backup.zip');
    const r = await writeBackupZip(fs.createWriteStream(zipFile), db, photos, { created: 'now' });
    expect(r.photos).toBe(5);
    expect(fs.statSync(zipFile).size).toBe(r.bytes);

    const out = tmp();
    const u = await unpackBackupZip(zipFile, out);
    expect(u).toMatchObject({ hasDb: true, photos: 5, manifest: { app: 'slay', photos: 5, created: 'now' } });
    expect(fs.readFileSync(path.join(out, 'slay.db')).equals(fs.readFileSync(db))).toBe(true);
    for (const [name, data] of Object.entries(files)) expect(fs.readFileSync(path.join(out, 'uploads', name)).equals(data)).toBe(true);
  });

  it('a zip can’t write outside its folder; unknown entries are skipped', async () => {
    const dir = tmp();
    const zipFile = path.join(dir, 'evil.zip');
    fs.writeFileSync(
      zipFile,
      zipSync({ '../evil.txt': Buffer.from('x'), 'uploads/../../evil2.txt': Buffer.from('x'), '/etc/evil3': Buffer.from('x'), 'uploads/ok.jpg': Buffer.from('photo'), 'notes.txt': Buffer.from('x') }),
    );
    const out = path.join(dir, 'out');
    const u = await unpackBackupZip(zipFile, out);
    expect(u).toMatchObject({ hasDb: false, photos: 1 });
    expect(fs.readdirSync(path.join(out, 'uploads'))).toEqual(['ok.jpg']);
    expect(fs.existsSync(path.join(dir, 'evil.txt'))).toBe(false);
    expect(fs.readdirSync(out).sort()).toEqual(['uploads']);
  });
});
