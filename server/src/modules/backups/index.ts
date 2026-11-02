import express, { Router } from 'express';
import { z } from 'zod';
import type { MailService } from '../messaging/mail.js';
import type { AppModule } from '../../core/context.js';
import { logActivity, service } from '../../core/context.js';
import { HttpError, parse } from '../../core/http.js';
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
      });
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

    // Restore, step 1: check the chosen backup file and say what's inside. Changes nothing.
    r.post('/restore/check', express.raw({ type: () => true, limit: '200mb' }), (req, res) => {
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Choose a backup file first.');
      res.json(backups().checkRestore(body));
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
