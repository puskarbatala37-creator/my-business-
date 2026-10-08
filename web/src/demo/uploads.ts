/**
 * Photo uploads in the demo: the photo is kept inside the in-browser database
 * and shown through a temporary browser URL (re-created each time the demo loads).
 */
import { Router } from './shims/express';
import type { AppContext, AppModule } from '../../../server/src/core/context';
import { badRequest } from '../../../server/src/core/http';

const ensureTable = (ctx: AppContext) =>
  ctx.db.exec('CREATE TABLE IF NOT EXISTS demo_files (id INTEGER PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, url TEXT)');

export function restoreFileUrls(ctx: AppContext) {
  ensureTable(ctx);
  const files = ctx.db.prepare('SELECT id, mime, data, url FROM demo_files').all() as { id: number; mime: string; data: Uint8Array; url: string | null }[];
  for (const f of files) {
    const fresh = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime }));
    if (f.url) {
      for (const [table, col] of [['variants', 'photo'], ['order_items', 'photo'], ['receipts', 'photo']]) {
        ctx.db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).run(fresh, f.url);
      }
    }
    ctx.db.prepare('UPDATE demo_files SET url = ? WHERE id = ?').run(fresh, f.id);
  }
}

export const demoUploadsModule: AppModule = {
  name: 'uploads',
  routes(ctx) {
    ensureTable(ctx);
    const r = Router();
    r.post('/', async (req: any, res: any) => {
      const file = (req.body as FormData | undefined)?.get('file');
      if (!(file instanceof Blob)) throw badRequest('Please choose a photo');
      const data = new Uint8Array(await file.arrayBuffer());
      const url = URL.createObjectURL(file);
      ctx.db.prepare('INSERT INTO demo_files (mime, data, url) VALUES (?, ?, ?)').run(file.type || 'image/jpeg', data, url);
      res.status(201).json({ path: url });
    });
    return r as any;
  },
};
