import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const api = process.env.SLAY_API ?? 'http://localhost:3000';
const shim = (f: string) => fileURLToPath(new URL(`./src/demo/shims/${f}`, import.meta.url));

export default defineConfig(({ mode }) => {
  // `vite build --mode demo`: self-contained preview where the server runs in the browser.
  const demo = mode === 'demo';
  return {
    plugins: [react()],
    base: demo ? './' : '/',
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
