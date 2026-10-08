/** Browser stand-in for node:crypto (only what the server code uses). */
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { Buffer } from 'buffer';

/** The browser Buffer polyfill lacks 'base64url' – add it on the buffers we hand out. */
function withBase64Url(b: Buffer): Buffer {
  const orig = b.toString.bind(b);
  (b as any).toString = (enc?: string, ...rest: number[]) =>
    enc === 'base64url' ? orig('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : orig(enc as BufferEncoding, ...rest);
  return b;
}

const toBytes = (d: string | Uint8Array) => (typeof d === 'string' ? new TextEncoder().encode(d) : d);
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

export function randomBytes(n: number) {
  return withBase64Url(Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))));
}

export function createHash(_alg: 'sha256') {
  const parts: Uint8Array[] = [];
  const h = {
    update(d: string | Uint8Array) {
      parts.push(toBytes(d));
      return h;
    },
    digest(enc?: BufferEncoding) {
      const b = withBase64Url(Buffer.from(sha256(concat(parts))));
      return enc ? (b as any).toString(enc) : b;
    },
  };
  return h;
}

export function createHmac(_alg: 'sha256', key: string | Uint8Array) {
  const parts: Uint8Array[] = [];
  const h = {
    update(d: string | Uint8Array) {
      parts.push(toBytes(d));
      return h;
    },
    digest(enc?: BufferEncoding) {
      const b = withBase64Url(Buffer.from(hmac(sha256, toBytes(key), concat(parts))));
      return enc ? (b as any).toString(enc) : b;
    },
  };
  return h;
}

export function randomInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

export default { randomBytes, createHash, createHmac, randomInt, timingSafeEqual };
