import { todayInBusinessTz } from '@slay/shared';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppContext, AppModule } from '../../core/context.js';
import { badRequest, HttpError, parse } from '../../core/http.js';
import { parseOrderSpeech, type VoiceCatalogVariant } from './parser.js';

export function voiceCatalog(ctx: AppContext): VoiceCatalogVariant[] {
  return ctx.db
    .prepare(
      `SELECT v.id, v.color, v.price, v.stock, v.voice_aliases, p.id AS product_id, p.name AS product_name, p.voice_aliases AS product_aliases,
              c.id AS category_id, c.name AS category_name, c.voice_aliases AS category_aliases
         FROM variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id
        WHERE v.archived = 0 AND p.archived = 0`,
    )
    .all() as VoiceCatalogVariant[];
}

/**
 * Voice entry. The phone's own speech recognition (Chrome on Android supports
 * Nepali, "ne-NP") produces text in the browser; iPhones and other browsers can
 * instead upload the recording to /transcribe, which uses a Whisper-compatible
 * speech-to-text API (TRANSCRIBE_API_KEY). Either way the text goes to /parse.
 */
export const voiceModule: AppModule = {
  name: 'voice',
  routes(ctx) {
    const r = Router();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

    r.get('/config', (_req, res) => res.json({ serverTranscription: !!ctx.config.transcribe.apiKey }));

    r.post('/parse', (req, res) => {
      const b = parse(z.object({ text: z.string().min(1).max(5000) }), req.body);
      res.json(parseOrderSpeech(b.text, voiceCatalog(ctx), todayInBusinessTz()));
    });

    r.post('/transcribe', upload.single('audio'), async (req, res) => {
      const { url, apiKey, model } = ctx.config.transcribe;
      if (!apiKey) throw new HttpError(501, 'Server speech-to-text is not configured (set TRANSCRIBE_API_KEY).');
      if (!req.file) throw badRequest('No audio received');
      const form = new FormData();
      const type = req.file.mimetype || 'audio/webm';
      const ext = type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
      form.append('file', new Blob([new Uint8Array(req.file.buffer)], { type }), `speech.${ext}`);
      form.append('model', model);
      form.append('language', String(req.body?.language || 'ne').slice(0, 5));
      form.append('prompt', 'साडी, कुर्था, रातो, निलो, वटा, रुपैयाँ, एडभान्स, इसेवा, भोलि डेलिभरी, तयार गर्न दिन');
      const resp = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(60_000) });
      if (!resp.ok) throw new HttpError(502, `Speech-to-text failed (${resp.status})`);
      const data = (await resp.json()) as { text?: string };
      res.json({ text: data.text ?? '' });
    });
    return r;
  },
};
