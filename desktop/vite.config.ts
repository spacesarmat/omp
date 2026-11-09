import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync('../package.json', 'utf8')) as { version: string };
const torrserverVersion = readFileSync('../torrserver.version', 'utf8').trim();

export default defineConfig({
  root: '.',
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __TORRSERVER_VERSION__: JSON.stringify(torrserverVersion),
    __TMDB_FALLBACK_KEY__: JSON.stringify(process.env.TMDB_API_KEY || ''),
  },
  plugins: [preact()],
  resolve: {
    dedupe: ['preact', '@preact/signals'],
    alias: [{ find: /.*\/platform\/native$/, replacement: resolve('src/platform/native.ts') }],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome90',
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
