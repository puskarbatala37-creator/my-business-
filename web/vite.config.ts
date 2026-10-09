import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const api = process.env.SLAY_API ?? 'http://localhost:3000';
const shim = (f: string) => fileURLToPath(new URL(`./src/demo/shims/${f}`, import.meta.url));

/**
 * Tells the service worker exactly which files make up this build, so the whole app is saved on the
 * phone at install time and opens offline. The version changes with every build, which makes
 * installed copies pick up the update on their next launch.
 */
function precacheServiceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'slay-precache-sw',
    apply: 'build',
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const sw = path.join(outDir, 'sw.js');
      if (!fs.existsSync(sw)) return;
      const assets = fs.readdirSync(path.join(outDir, 'assets')).map((f) => `/assets/${f}`);
      const files = ['/', '/manifest.webmanifest', '/favicon.ico', '/apple-touch-icon.png', '/icons/icon.svg', '/icons/icon-192.png', '/icons/monochrome-512.png', ...assets.sort()];
      const version = createHash('sha256').update(files.join('\n')).update(fs.readFileSync(path.join(outDir, 'index.html'))).digest('hex').slice(0, 12);
      const head = `self.__SLAY_VERSION__ = ${JSON.stringify(version)};\nself.__SLAY_PRECACHE__ = ${JSON.stringify(files)};\n`;
      fs.writeFileSync(sw, head + fs.readFileSync(sw, 'utf8'));
    },
  };
}

/** The hosted demo preview can't be installed: drop the install-only links from its page. */
function demoHtml(): Plugin {
  return {
    name: 'slay-demo-html',
    transformIndexHtml: (html) => html.replace(/^\s*<link rel="(manifest|apple-touch-startup-image|apple-touch-icon|icon)"[^>]*>\n/gm, ''),
  };
}

export default defineConfig(({ mode }) => {
  // `vite build --mode demo`: self-contained preview where the server runs in the browser.
  const demo = mode === 'demo';
  return {
    plugins: [react(), demo ? demoHtml() : precacheServiceWorker()],
    base: demo ? './' : '/',
    // Icons, launch screens and the service worker are only for the installable app.
    publicDir: demo ? false : 'public',
    // A build-time constant, so the regular app build drops all demo-only code.
    define: {
      'import.meta.env.VITE_DEMO': JSON.stringify(demo ? '1' : '0'),
      ...(demo ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {}),
    },
    resolve: {
      alias: (demo
        ? {
            express: shim('express.ts'),
            multer: shim('multer.ts'),
            'web-push': shim('webpush.ts'),
            nodemailer: shim('nodemailer.ts'),
            'better-sqlite3': shim('better-sqlite3.ts'),
            'node:crypto': shim('crypto.ts'),
            'node:fs': shim('fs.ts'),
            'node:path': shim('path.ts'),
            '@simplewebauthn/server': shim('simplewebauthn.ts'),
            buffer: fileURLToPath(new URL('../node_modules/buffer/index.js', import.meta.url)),
          }
        : {}) as Record<string, string>,
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: api, changeOrigin: false },
        '/uploads': { target: api, changeOrigin: false },
      },
    },
    build: demo
      ? { outDir: 'dist-demo', sourcemap: false, // SQLite's WebAssembly is embedded in the script, so the preview is a few self-contained files.
          assetsInlineLimit: (file: string) => file.endsWith('.wasm'), chunkSizeWarningLimit: 4000 }
      : { outDir: 'dist', sourcemap: false },
  };
});
