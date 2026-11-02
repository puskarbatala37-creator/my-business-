import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { service } from '../src/core/context.js';
import type { AuthService } from '../src/modules/auth/service.js';
import { unpackBackupZip } from '../src/modules/backups/archive.js';
import { BackupService, restoreIfRequested } from '../src/modules/backups/service.js';
import { seedCatalog, w } from './helpers.js';

function configFor(dataDir: string) {
  return loadConfig({ dataDir, dbFile: path.join(dataDir, 'slay.db'), uploadsDir: path.join(dataDir, 'uploads'), appUrl: 'http://slay.test', webDist: '/nonexistent', initialUsers: '' });
}
function fileApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slay-backup-'));
  const config = configFor(dataDir);
  const created = createApp(config);
  const auth = service<AuthService>(created.ctx, 'auth');
  auth.createUser({ email: 'teza@example.com', displayName: 'Teza', password: 'password-teza', role: 'owner', phone: '9841000001' });
  auth.createUser({ email: 'sita@example.com', displayName: 'Sita', password: 'password-sita', role: 'member', phone: '9841000003' });
  return { ...created, dataDir, config };
}
const signIn = async (app: any, email: string, password: string) => {
  const a = request.agent(app);
  await a.post('/api/auth/login').set('x-slay', '1').send({ email, password });
  return w(a);
};
const ordersIn = (file: string) => {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare('SELECT o.invoice_no, c.name FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id').all() as { invoice_no: string; name: string }[];
  } finally {
    db.close();
  }
};
/** A photo as Slay stores it in DATA_DIR/uploads. */
const addPhoto = (dataDir: string, bytes = 200_000) => {
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.jpg`;
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const data = crypto.randomBytes(bytes);
  fs.writeFileSync(path.join(dataDir, 'uploads', name), data);
  return { name, data };
};
const download = async (agent: any) =>
  agent.get('/api/backups/download').buffer(true).parse((r: any, cb: any) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('daily copies on the server (with photos)', () => {
  it('one copy a day with that day’s photos; keeps the last 7; photos are shared, not duplicated', async () => {
    const s = fileApp();
    const p1 = addPhoto(s.dataDir);
    const b = service<BackupService>(s.ctx, 'backups');
    const file = await b.daily();
    const day = path.basename(file).slice(5, 15);
    const shot = path.join(b.dir, `photos-${day}`, p1.name);
    expect(fs.readFileSync(shot).equals(p1.data)).toBe(true);
    // Hard link: the same file on disk, so the copy takes no extra space.
    expect(fs.statSync(shot).ino).toBe(fs.statSync(path.join(s.dataDir, 'uploads', p1.name)).ino);
    const before = fs.statSync(file).mtimeMs;
    await b.daily(); // same day: not taken again
    expect(fs.statSync(file).mtimeMs).toBe(before);

    for (let d = 1; d <= 20; d++) {
      const dd = `2026-01-${String(d).padStart(2, '0')}`;
      fs.copyFileSync(file, path.join(b.dir, `slay-${dd}.db`));
      fs.mkdirSync(path.join(b.dir, `photos-${dd}`));
    }
    fs.copyFileSync(file, path.join(b.dir, 'before-restore-2026-01-01T00-00-00-000Z.db'));
    await b.daily();
    const kept = b.list();
    expect(kept).toHaveLength(7);
    expect(kept[0]).toMatchObject({ day, photos: 1 });
    const photoDirs = fs.readdirSync(b.dir).filter((f) => f.startsWith('photos-'));
    expect(photoDirs.sort()).toEqual(kept.map((k) => `photos-${k.day}`).sort());
    expect(fs.existsSync(path.join(b.dir, 'before-restore-2026-01-01T00-00-00-000Z.db'))).toBe(true);
    // The live photo is untouched.
    expect(fs.readFileSync(path.join(s.dataDir, 'uploads', p1.name)).equals(p1.data)).toBe(true);
  });

  it('reports disk use, counting a shared photo once', async () => {
    const s = fileApp();
    addPhoto(s.dataDir, 500_000);
    const b = service<BackupService>(s.ctx, 'backups');
    await b.daily();
    const d = b.disk();
    expect(d.photos).toBe(500_000);
    expect(d.backups).toBeLessThan(500_000); // the daily copy's photo is the same file
    expect(d.total).toBeGreaterThan(0);
    expect(typeof d.usedPct).toBe('number');
    const teza = await signIn(s.app, 'teza@example.com', 'password-teza');
    expect((await teza.get('/api/backups')).body.disk).toMatchObject({ photos: 500_000 });
  });
});

describe('manual backup: one zip with the data and every photo', () => {
  it('owners download it; it holds the database and all photos; members can’t', async () => {
    const s = fileApp();
    const teza = await signIn(s.app, 'teza@example.com', 'password-teza');
    const cat = await seedCatalog(teza);
    const o = await teza.post('/api/orders', { platform: 'tiktok', customer: { name: 'Rina Karki', phone: '9851098765' }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 3500 }] });
    expect(o.status).toBe(201);
    const photos = [addPhoto(s.dataDir), addPhoto(s.dataDir), addPhoto(s.dataDir)];

    const sita = await signIn(s.app, 'sita@example.com', 'password-sita');
    expect((await sita.get('/api/backups')).status).toBe(403);
    expect((await sita.get('/api/backups/download')).status).toBe(403);

    const res = await download(teza);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="slay-backup-.*\.zip"/);
    const zipFile = path.join(s.dataDir, 'dl.zip');
    fs.writeFileSync(zipFile, res.body);
    const out = path.join(s.dataDir, 'unpacked');
    const u = await unpackBackupZip(zipFile, out);
    expect(u).toMatchObject({ hasDb: true, photos: 3, manifest: { app: 'slay', photos: 3 } });
    expect(ordersIn(path.join(out, 'slay.db'))).toEqual([{ invoice_no: o.body.invoice_no, name: 'Rina Karki' }]);
    for (const p of photos) expect(fs.readFileSync(path.join(out, 'uploads', p.name)).equals(p.data)).toBe(true);

    const info = (await teza.get('/api/backups')).body;
    expect(info.lastDownload.by).toBe('Teza');
    const log = (await teza.get('/api/security/alerts')).body.alerts;
    expect(log.some((a: any) => a.kind === 'backup_downloaded' && a.severity === 'info')).toBe(true);
  });
});

describe('daily backup by email', () => {
  const mailCatcher = (s: any) => {
    const sent: { to: string[]; subject: string; text: string; attachments: { filename: string; content: Buffer }[] }[] = [];
    s.ctx.services.mail = { configured: true, send: async (to: string[], subject: string, text: string, attachments: any) => void sent.push({ to, subject, text, attachments }) };
    return sent;
  };

  it('under 20 MB: one zip with the data and photos, to every owner, once a day', async () => {
    const s = fileApp();
    service<AuthService>(s.ctx, 'auth').createUser({ email: 'partner@example.com', displayName: 'Partner', password: 'password-partner', role: 'owner' });
    const p = addPhoto(s.dataDir);
    const sent = mailCatcher(s);
    const b = service<BackupService>(s.ctx, 'backups');
    await b.daily();
    await b.daily(); // same day: not sent again
    expect(sent).toHaveLength(1);
    expect(sent[0].to.sort()).toEqual(['partner@example.com', 'teza@example.com']); // owners only
    expect(sent[0].subject).toMatch(/^Slay daily backup – \d{4}-\d{2}-\d{2}$/);
    const att = sent[0].attachments[0];
    expect(att.filename).toMatch(/^slay-backup-.*\.zip$/);
    expect(sent[0].text).toMatch(/all 1 photos/);
    const zipFile = path.join(s.dataDir, 'mail.zip');
    fs.writeFileSync(zipFile, att.content);
    const u = await unpackBackupZip(zipFile, path.join(s.dataDir, 'mail-out'));
    expect(u).toMatchObject({ hasDb: true, photos: 1 });
    expect(fs.readFileSync(path.join(s.dataDir, 'mail-out', 'uploads', p.name)).equals(p.data)).toBe(true);
    expect(b.lastEmail()).toMatchObject({ ok: true, photos: true });
    expect(fs.readdirSync(b.dir).filter((f) => f.startsWith('email-'))).toEqual([]); // temporary zip removed
  });

  it('over 20 MB: only the data, and the email says the photos are in the manual backup', async () => {
    const s = fileApp();
    addPhoto(s.dataDir, 12_000_000);
    addPhoto(s.dataDir, 12_000_000);
    const sent = mailCatcher(s);
    const b = service<BackupService>(s.ctx, 'backups');
    await b.daily();
    const att = sent[0].attachments[0];
    expect(att.filename).toMatch(/^slay-backup-.*\.db\.gz$/);
    expect(zlib.gunzipSync(att.content).subarray(0, 15).toString()).toBe('SQLite format 3');
    expect(sent[0].text).toMatch(/2 photos together are over 20 MB/);
    expect(sent[0].text).toMatch(/More → Backups → Save a backup now/);
    expect(b.lastEmail()).toMatchObject({ ok: true, photos: false });
  });

  it('without email set up, the copy is still made and the Backups screen says why nothing was emailed', async () => {
    const s = fileApp();
    s.ctx.services.mail = { configured: false, send: async () => {} };
    const b = service<BackupService>(s.ctx, 'backups');
    expect(fs.existsSync(await b.daily())).toBe(true);
    const teza = await signIn(s.app, 'teza@example.com', 'password-teza');
    const r = (await teza.get('/api/backups')).body;
    expect(r.keepDays).toBe(7);
    expect(r.email).toMatchObject({ configured: false, last: { ok: false, error: expect.stringMatching(/not set up/) } });
  });
});

describe('restore', () => {
  /** A shop with orders and photos, and its downloaded zip backup. */
  async function shopWithBackup() {
    const shop = fileApp();
    const teza = await signIn(shop.app, 'teza@example.com', 'password-teza');
    const cat = await seedCatalog(teza);
    for (const n of [1, 2, 3]) {
      expect((await teza.post('/api/orders', { platform: 'tiktok', customer: { name: `Customer ${n}`, phone: `980000000${n}` }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 3500 }] })).status).toBe(201);
    }
    const photos = [addPhoto(shop.dataDir), addPhoto(shop.dataDir), addPhoto(shop.dataDir), addPhoto(shop.dataDir)];
    const zip: Buffer = (await download(teza)).body;
    return { shop, photos, zip };
  }

  it('from the app with a zip: check (changes nothing) → apply → restart → data AND photos are back', async () => {
    const { photos, zip } = await shopWithBackup();
    // A brand-new server: a temporary owner, and one photo of its own that must survive.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slay-restore-'));
    const config = configFor(dataDir);
    const fresh = createApp(config);
    const own = addPhoto(dataDir);
    let restarts = 0;
    fresh.ctx.services.restartProcess = () => void restarts++;
    const code = service<AuthService>(fresh.ctx, 'auth').setupCode;
    const temp = request.agent(fresh.app);
    expect((await temp.post('/api/auth/setup').set('x-slay', '1').send({ code, displayName: 'Temp', email: 'temp@example.com', password: 'temp-pass-1' })).status).toBe(200);
    const upload = (body: Buffer) => temp.post('/api/backups/restore/check').set('x-slay', '1').set('Content-Type', 'application/octet-stream').send(body);

    // Not a backup → refused, nothing changes.
    expect((await upload(Buffer.from('hello, this is a photo'))).body.error).toMatch(/isn’t a Slay backup/);
    const otherDb = path.join(dataDir, 'other.db');
    new Database(otherDb).exec('CREATE TABLE notes (x TEXT)');
    expect((await upload(fs.readFileSync(otherDb))).body.error).toMatch(/not a Slay backup/);
    expect((await upload(zip.subarray(0, 2000))).status).toBe(400); // a cut-off zip

    const check = await upload(zip);
    expect(check.status).toBe(200);
    expect(check.body.summary).toMatchObject({ accounts: 2, orders: 3, customers: 3, products: 1, photos: 4, owners: [{ name: 'Teza', email: 'teza@example.com' }] });
    expect((await temp.get('/api/orders')).body.summary.count).toBe(0);
    expect(fs.existsSync(path.join(dataDir, 'restore'))).toBe(false);
    expect(fs.readdirSync(path.join(dataDir, 'uploads'))).toEqual([own.name]);

    const apply = await temp.post('/api/backups/restore/apply').set('x-slay', '1').send({ token: check.body.token });
    expect(apply.body).toEqual({ restarting: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(restarts).toBe(1);

    // "Restart": a new start on the same disk swaps the data in and adds the photos.
    fresh.ctx.db.close();
    const after = createApp(config);
    const back = await signIn(after.app, 'teza@example.com', 'password-teza');
    expect((await back.get('/api/orders')).body.summary.count).toBe(3);
    for (const p of photos) expect(fs.readFileSync(path.join(dataDir, 'uploads', p.name)).equals(p.data)).toBe(true);
    expect(fs.readFileSync(path.join(dataDir, 'uploads', own.name)).equals(own.data)).toBe(true); // never removed
    // Served to the app again.
    const photoRes = await back.get(`/uploads/${photos[0].name}`);
    expect(photoRes.status).toBe(200);
    expect(fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.startsWith('before-restore-'))).toHaveLength(1);
    expect(fs.readdirSync(path.join(dataDir, 'restore'))).toEqual([]);
    const alerts = (await back.get('/api/security/alerts')).body.alerts;
    expect(alerts.some((a: any) => a.kind === 'data_restored' && /with 4 photos/.test(a.message))).toBe(true);
  });

  it('a photo already on the server is never overwritten by the backup', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slay-restore-'));
    const config = configFor(dataDir);
    const app = createApp(config);
    const keepMe = addPhoto(dataDir);
    fs.mkdirSync(path.join(dataDir, 'restore', 'r1', 'uploads'), { recursive: true });
    await app.ctx.db.backup(path.join(dataDir, 'restore', 'r1', 'slay.db'));
    fs.writeFileSync(path.join(dataDir, 'restore', 'r1', 'uploads', keepMe.name), 'a different file with the same name');
    app.ctx.db.close();
    expect(restoreIfRequested(dataDir, config.dbFile, config.uploadsDir)).toBe('r1 (with 0 photos)');
    expect(fs.readFileSync(path.join(dataDir, 'uploads', keepMe.name)).equals(keepMe.data)).toBe(true);
  });

  it('older data-only backups (.db.gz) still restore – from the app and by hand – keeping the replaced data complete', async () => {
    const s = fileApp();
    const teza = await signIn(s.app, 'teza@example.com', 'password-teza');
    const cat = await seedCatalog(teza);
    await teza.post('/api/orders', { platform: 'tiktok', customer: { name: 'Before Backup' }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 100 }] });
    const tmp = path.join(s.dataDir, 'old.db');
    await s.ctx.db.backup(tmp);
    const gz = zlib.gzipSync(fs.readFileSync(tmp));
    await teza.post('/api/orders', { platform: 'tiktok', customer: { name: 'After Backup' }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 100 }] });

    // From the app: the check accepts it (no photos inside).
    const owner = request.agent(s.app);
    await owner.post('/api/auth/login').set('x-slay', '1').send({ email: 'teza@example.com', password: 'password-teza' });
    const check = await owner.post('/api/backups/restore/check').set('x-slay', '1').set('Content-Type', 'application/octet-stream').send(gz);
    expect(check.body.summary).toMatchObject({ orders: 1, photos: 0 });

    // By hand: put it in DATA_DIR/restore and restart. "After Backup" is still only in the -wal file –
    // the copy kept before restoring must include it.
    s.ctx.db.pragma('wal_autocheckpoint = 0');
    fs.mkdirSync(path.join(s.dataDir, 'restore'));
    fs.writeFileSync(path.join(s.dataDir, 'restore', 'slay-backup-2026-10-09-08-00.db.gz'), gz);
    s.ctx.db.close();
    expect(restoreIfRequested(s.dataDir, s.config.dbFile, s.config.uploadsDir)).toBe('slay-backup-2026-10-09-08-00.db.gz');
    expect(ordersIn(s.config.dbFile).map((r) => r.name)).toEqual(['Before Backup']);
    const kept = fs.readdirSync(path.join(s.dataDir, 'backups')).find((f) => f.startsWith('before-restore-'))!;
    expect(ordersIn(path.join(s.dataDir, 'backups', kept)).map((r) => r.name).sort()).toEqual(['After Backup', 'Before Backup']);
    expect(fs.readdirSync(path.join(s.dataDir, 'restore'))).toEqual([]);

    fs.writeFileSync(path.join(s.dataDir, 'restore', 'photo.db'), 'not a database');
    expect(() => restoreIfRequested(s.dataDir, s.config.dbFile)).toThrow(/not a Slay backup/);
    expect(ordersIn(s.config.dbFile).map((r) => r.name)).toEqual(['Before Backup']);
  });

  it('members can’t restore', async () => {
    const s = fileApp();
    const sita = request.agent(s.app);
    await sita.post('/api/auth/login').set('x-slay', '1').send({ email: 'sita@example.com', password: 'password-sita' });
    const r = await sita.post('/api/backups/restore/check').set('x-slay', '1').set('Content-Type', 'application/octet-stream').send(Buffer.from('x'));
    expect(r.status).toBe(403);
  });
});
