import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import multer from 'multer';
import type { AppModule } from '../../core/context.js';
import { badRequest } from '../../core/http.js';

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif', 'image/gif': '.gif' };

/**
 * Photo uploads (product colours, order items, supplier bills). Files are kept
 * on local disk under DATA_DIR/uploads; swap this module for S3/R2 storage later
 * without touching the rest of the app – everything else only stores the returned path.
 */
export const uploadsModule: AppModule = {
  name: 'uploads',
  routes(ctx) {
    fs.mkdirSync(ctx.config.uploadsDir, { recursive: true });
    const upload = multer({
      storage: multer.diskStorage({
        destination: ctx.config.uploadsDir,
        filename: (_req, file, cb) => cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${EXT[file.mimetype] ?? '.jpg'}`),
      }),
      limits: { fileSize: 15 * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => cb(null, file.mimetype in EXT),
    });
    const r = Router();
    r.post('/', upload.single('file'), (req, res) => {
      if (!req.file) throw badRequest('Please choose a photo (JPEG, PNG, WebP or HEIC)');
      res.status(201).json({ path: `/uploads/${req.file.filename}` });
    });
    return r;
  },
};

/** Static file server for uploaded photos (mounted behind login). */
export function serveUploads(dir: string) {
  return express.static(path.resolve(dir), { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' });
}
