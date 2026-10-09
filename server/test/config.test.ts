import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('public address', () => {
  it('uses the address Render provides when APP_URL is not set', () => {
    delete process.env.APP_URL;
    process.env.NODE_ENV = 'production';
    process.env.RENDER_EXTERNAL_URL = 'https://slay.onrender.com';
    const c = loadConfig();
    expect(c.appUrl).toBe('https://slay.onrender.com');
    expect(c.webauthn.rpID).toBe('slay.onrender.com');
    expect(c.vapidSubject).toBe('https://slay.onrender.com');
  });

  it('APP_URL (e.g. a custom domain) wins', () => {
    process.env.RENDER_EXTERNAL_URL = 'https://slay.onrender.com';
    process.env.APP_URL = 'https://shop.example.com/';
    expect(loadConfig().appUrl).toBe('https://shop.example.com');
  });
});
