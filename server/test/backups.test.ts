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
  it('takes one copy a day and keeps the last 14', async () => {
    const s = fileApp();
    const b = service<BackupService>(s.ctx, 'backups');
    const file = await b.daily();
    expect(fs.existsSync(file)).toBe(true);
    const before = fs.statSync(file).mtimeMs;
    await b.daily(); // same day: not taken again
    expect(fs.statSync(file).mtimeMs).toBe(before);
    for (let d = 1; d <= 20; d++) fs.copyFileSync(file, path.join(b.dir, `slay-2026-01-${String(d).padStart(2, '0')}.db`));
    await b.daily();
    const kept = b.list();
    expect(kept).toHaveLength(14);
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
