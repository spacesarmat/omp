import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const desktopPackage = JSON.parse(readFileSync(resolve('desktop/package.json'), 'utf8')) as { version: string };
const torrserverVersion = readFileSync(resolve('torrserver.version'), 'utf8').trim();

export default defineConfig({
  root: resolve('editor'),
  base: '/',
  define: {
    __DESKTOP__: 'true',
    __APP_VERSION__: JSON.stringify(desktopPackage.version),
    __TORRSERVER_VERSION__: JSON.stringify(torrserverVersion),
    __TMDB_FALLBACK_KEY__: '""',
  },
  plugins: [preact()],
  resolve: {
    dedupe: ['preact', '@preact/signals'],
    alias: [{ find: /.*\/platform\/native$/, replacement: resolve('desktop/src/preview/native.ts') }],
  },
  build: {
    outDir: resolve('dist-editor'),
    emptyOutDir: true,
    target: 'chrome90',
    rollupOptions: {
      input: {
        main: resolve('editor/index.html'),
        preview: resolve('editor/preview.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    fs: {
      allow: [resolve('src'), resolve('mobile'), resolve('desktop'), resolve('design'), resolve('editor'), resolve('node_modules'), resolve('desktop/node_modules')],
      deny: ['**/.env', '**/.env.*'],
    },
  },
});
