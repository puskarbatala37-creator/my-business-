import { Router } from 'express';
import type { AppModule } from '../../core/context.js';
import { logActivity, service } from '../../core/context.js';
import { requireOwner } from '../auth/index.js';
import type { AlertService } from '../security/service.js';
import { BackupService, KEEP_DAYS } from './service.js';

/** Backups (owners only): the daily copies kept on the server, and downloading one. */
export const backupsModule: AppModule = {
  name: 'backups',
  init(ctx) {
    ctx.services.backups = new BackupService(ctx);
  },
  routes(ctx) {
    const r = Router();
    const backups = () => service<BackupService>(ctx, 'backups');
    r.use(requireOwner);
    r.get('/', (_req, res) => {
      const last = backups().lastDownload();
      const by = last ? (ctx.db.prepare('SELECT display_name FROM users WHERE id = ?').get(last.by) as { display_name: string } | undefined) : undefined;
      res.json({ keepDays: KEEP_DAYS, backups: backups().list(), lastDownload: last ? { at: last.at, by: by?.display_name ?? '' } : null });
    });
    r.get('/download', async (req, res) => {
      const data = await backups().forDownload(req.user!.id);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
      logActivity(ctx, req.user!.id, 'backup_downloaded', 'backup', null, {});
      // Downloading everyone's customer data is worth a line in the team's activity log.
      service<AlertService>(ctx, 'alerts').raise('backup_downloaded', 'info', `${req.user!.displayName} downloaded a backup of all Slay data.`, {}, req.user!.id);
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="slay-backup-${stamp}.db.gz"`);
      res.setHeader('Cache-Control', 'no-store');
      res.end(data);
    });
    return r;
  },
  start(ctx) {
    const run = () =>
      service<BackupService>(ctx, 'backups')
        .daily()
        .catch((e) => console.error('[backups] daily copy failed:', e));
    void run();
    const t = setInterval(run, 60 * 60 * 1000); // checks hourly, copies once a day
    return () => clearInterval(t);
  },
};
