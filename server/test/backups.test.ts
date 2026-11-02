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
import { BackupService, restoreIfRequested } from '../src/modules/backups/service.js';
import { seedCatalog, w } from './helpers.js';

function fileApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slay-backup-'));
  const config = loadConfig({ dataDir, dbFile: path.join(dataDir, 'slay.db'), uploadsDir: path.join(dataDir, 'uploads'), appUrl: 'http://slay.test', webDist: '/nonexistent', initialUsers: '' });
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
    return (db.prepare('SELECT o.invoice_no, c.name FROM orders o JOIN customers c ON c.id = o.customer_id').all() as any[]);
  } finally {
    db.close();
  }
};

describe('backups', () => {
  it('takes one copy a day and keeps the last 7 (before-restore copies are never removed)', async () => {
    const s = fileApp();
    const b = service<BackupService>(s.ctx, 'backups');
    const file = await b.daily();
    expect(fs.existsSync(file)).toBe(true);
    const before = fs.statSync(file).mtimeMs;
    await b.daily(); // same day: not taken again
    expect(fs.statSync(file).mtimeMs).toBe(before);
    for (let d = 1; d <= 20; d++) fs.copyFileSync(file, path.join(b.dir, `slay-2026-01-${String(d).padStart(2, '0')}.db`));
    fs.copyFileSync(file, path.join(b.dir, 'before-restore-2026-01-01T00-00-00-000Z.db'));
    await b.daily();
    const kept = b.list();
    expect(kept).toHaveLength(7);
    expect(fs.existsSync(path.join(b.dir, 'before-restore-2026-01-01T00-00-00-000Z.db'))).toBe(true);
    expect(kept[0].name).toBe(path.basename(file)); // today's is kept, the oldest are gone
  });

  it('owners download a real, complete copy; team members can’t', async () => {
    const s = fileApp();
    const teza = await signIn(s.app, 'teza@example.com', 'password-teza');
    const cat = await seedCatalog(teza);
    const o = await teza.post('/api/orders', { platform: 'tiktok', customer: { name: 'Rina Karki', phone: '9851098765' }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 3500 }] });
    expect(o.status).toBe(201);

    const sita = await signIn(s.app, 'sita@example.com', 'password-sita');
    expect((await sita.get('/api/backups')).status).toBe(403);
    expect((await sita.get('/api/backups/download')).status).toBe(403);

    const res = await teza.get('/api/backups/download').buffer(true).parse((r: any, cb: any) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="slay-backup-.*\.db\.gz"/);
    const file = path.join(s.dataDir, 'downloaded.db');
    fs.writeFileSync(file, zlib.gunzipSync(res.body));
    expect(ordersIn(file)).toEqual([{ invoice_no: o.body.invoice_no, name: 'Rina Karki' }]);

    const info = (await teza.get('/api/backups')).body;
    expect(info.lastDownload.by).toBe('Teza');
    const log = (await teza.get('/api/security/alerts')).body.alerts;
    expect(log.some((a: any) => a.kind === 'backup_downloaded' && a.severity === 'info')).toBe(true);
  });

  it('restores a downloaded backup on restart and keeps the data it replaced', async () => {
    const s = fileApp();
    const teza = await signIn(s.app, 'teza@example.com', 'password-teza');
    const cat = await seedCatalog(teza);
    await teza.post('/api/orders', { platform: 'tiktok', customer: { name: 'Before Backup' }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 100 }] });
    const gz = await service<BackupService>(s.ctx, 'backups').forDownload(1);
    await teza.post('/api/orders', { platform: 'tiktok', customer: { name: 'After Backup' }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 100 }] });
    s.ctx.db.close();

    fs.mkdirSync(path.join(s.dataDir, 'restore'));
    fs.writeFileSync(path.join(s.dataDir, 'restore', 'slay-backup-2026-10-09-08-00.db.gz'), gz);
    expect(restoreIfRequested(s.dataDir, s.config.dbFile)).toBe('slay-backup-2026-10-09-08-00.db.gz');
    expect(ordersIn(s.config.dbFile).map((r) => r.name)).toEqual(['Before Backup']);
    const kept = fs.readdirSync(path.join(s.dataDir, 'backups')).find((f) => f.startsWith('before-restore-'))!;
    expect(ordersIn(path.join(s.dataDir, 'backups', kept)).map((r) => r.name).sort()).toEqual(['After Backup', 'Before Backup']);
    expect(fs.readdirSync(path.join(s.dataDir, 'restore'))).toEqual([]); // used once

    // Something that isn't a backup is refused and nothing changes.
    fs.writeFileSync(path.join(s.dataDir, 'restore', 'photo.db'), 'not a database');
    expect(() => restoreIfRequested(s.dataDir, s.config.dbFile)).toThrow(/not a Slay backup/);
    expect(ordersIn(s.config.dbFile).map((r) => r.name)).toEqual(['Before Backup']);
  });
});

describe('daily backup by email', () => {
  it('emails the new daily copy to every owner (once a day), as a real backup file', async () => {
    const s = fileApp();
    service<AuthService>(s.ctx, 'auth').createUser({ email: 'partner@example.com', displayName: 'Partner', password: 'password-partner', role: 'owner' });
    const sent: { to: string[]; subject: string; attachments?: { filename: string; content: Buffer }[] }[] = [];
    s.ctx.services.mail = { configured: true, send: async (to: string[], subject: string, _t: string, attachments?: any) => void sent.push({ to, subject, attachments }) };
    const b = service<BackupService>(s.ctx, 'backups');
    await b.daily();
    await b.daily(); // same day: not sent again
    expect(sent).toHaveLength(1);
    expect(sent[0].to.sort()).toEqual(['partner@example.com', 'teza@example.com']); // owners only, not Sita (member)
    expect(sent[0].subject).toMatch(/^Slay daily backup – \d{4}-\d{2}-\d{2}$/);
    const att = sent[0].attachments![0];
    expect(att.filename).toMatch(/^slay-backup-.*\.db\.gz$/);
    expect(zlib.gunzipSync(att.content).subarray(0, 15).toString()).toBe('SQLite format 3');
    expect(b.lastEmail()!.ok).toBe(true);
    expect(b.lastEmail()!.to!.sort()).toEqual(['partner@example.com', 'teza@example.com']);
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

describe('restore from a backup file, in the app', () => {
  it('check (changes nothing) → apply → restart: the old data is back and the replaced data is kept', async () => {
    // The shop's real data …
    const shop = fileApp();
    const teza = await signIn(shop.app, 'teza@example.com', 'password-teza');
    const cat = await seedCatalog(teza);
    for (const n of [1, 2, 3]) {
      expect((await teza.post('/api/orders', { platform: 'tiktok', customer: { name: `Customer ${n}`, phone: `980000000${n}` }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 3500 }] })).status).toBe(201);
    }
    const download = await teza.get('/api/backups/download').buffer(true).parse((res: any, cb: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const backupFile: Buffer = download.body;

    // … and a brand-new, empty server where a temporary owner was created on the setup screen.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slay-restore-'));
    const config = loadConfig({ dataDir, dbFile: path.join(dataDir, 'slay.db'), uploadsDir: path.join(dataDir, 'uploads'), appUrl: 'http://slay.test', webDist: '/nonexistent', initialUsers: '' });
    const fresh = createApp(config);
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

    // Real backup → what's inside, nothing changed yet.
    const check = await upload(backupFile);
    expect(check.status).toBe(200);
    expect(check.body.summary).toMatchObject({ accounts: 2, orders: 3, customers: 3, products: 1, owners: [{ name: 'Teza', email: 'teza@example.com' }] });
    expect((await temp.get('/api/orders')).body.summary.count).toBe(0);
    expect(fs.existsSync(path.join(dataDir, 'restore'))).toBe(false);

    // Apply → handed over for the restart.
    expect((await temp.post('/api/backups/restore/apply').set('x-slay', '1').send({ token: 'f'.repeat(24) })).status).toBe(410);
    const apply = await temp.post('/api/backups/restore/apply').set('x-slay', '1').send({ token: check.body.token });
    expect(apply.body).toEqual({ restarting: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(restarts).toBe(1);

    // "Restart": a new start on the same disk swaps the backup in.
    fresh.ctx.db.close();
    const after = createApp(config);
    const back = await signIn(after.app, 'teza@example.com', 'password-teza');
    expect((await back.get('/api/orders')).body.summary.count).toBe(3);
    expect(service<AuthService>(after.ctx, 'auth').findByLogin('temp@example.com')).toBeUndefined();
    const kept = fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.startsWith('before-restore-'));
    expect(kept).toHaveLength(1); // the replaced (temporary) data is kept
    expect(fs.readdirSync(path.join(dataDir, 'restore'))).toEqual([]);
    const alerts = (await back.get('/api/security/alerts')).body.alerts;
    expect(alerts.some((a: any) => a.kind === 'data_restored')).toBe(true);
  });

  it('members can’t restore', async () => {
    const s = fileApp();
    const sita = request.agent(s.app);
    await sita.post('/api/auth/login').set('x-slay', '1').send({ email: 'sita@example.com', password: 'password-sita' });
    const r = await sita.post('/api/backups/restore/check').set('x-slay', '1').set('Content-Type', 'application/octet-stream').send(Buffer.from('x'));
    expect(r.status).toBe(403);
  });
});
