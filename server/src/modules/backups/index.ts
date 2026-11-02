import { Router } from 'express';
import { z } from 'zod';
import type { MailService } from '../messaging/mail.js';
import type { AppModule } from '../../core/context.js';
import { logActivity, service } from '../../core/context.js';
import { parse } from '../../core/http.js';
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
      res.json({
        keepDays: KEEP_DAYS,
        backups: backups().list(),
        lastDownload: last ? { at: last.at, by: by?.display_name ?? '' } : null,
        email: { configured: !!(ctx.services.mail as MailService | undefined)?.configured, last: backups().lastEmail() },
        disk: backups().disk(),
      });
    });
    // One zip with the database and every photo, streamed straight to the phone.
    r.get('/download', async (req, res) => {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="slay-backup-${stamp}.zip"`);
      res.setHeader('Cache-Control', 'no-store');
      const r = await backups().streamDownload(res, req.user!.id);
      logActivity(ctx, req.user!.id, 'backup_downloaded', 'backup', null, { photos: r.photos });
      // Downloading everyone's customer data is worth a line in the team's activity log.
      service<AlertService>(ctx, 'alerts').raise('backup_downloaded', 'info', `${req.user!.displayName} downloaded a backup of all Slay data and photos.`, {}, req.user!.id);
    });

    // Restore, step 1: check the chosen backup file and say what's inside. Changes nothing.
    // The file is saved straight to disk as it arrives (a zip with photos can be large).
    r.post('/restore/check', async (req, res) => {
      res.json(await backups().checkRestore(req));
    });

    // Restore, step 2 (after the owner confirms): swap the backup in on a restart.
    r.post('/restore/apply', (req, res) => {
      const b = parse(z.object({ token: z.string() }), req.body);
      backups().applyRestore(b.token);
      logActivity(ctx, req.user!.id, 'restore_requested', 'backup', null, {});
      const restart = ctx.services.restartProcess as (() => void) | undefined;
      res.json({ restarting: !!restart });
      // Let the reply reach the phone first; the host starts Slay again straight away.
      if (restart) setTimeout(restart, 300);
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
