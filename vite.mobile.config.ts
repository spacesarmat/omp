import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const torrserverVersion = readFileSync('torrserver.version', 'utf8').trim();

export default defineConfig({
  root: 'mobile',
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __TORRSERVER_VERSION__: JSON.stringify(torrserverVersion),
  },
  plugins: [preact()],
  build: {
    outDir: '../dist-mobile',
    emptyOutDir: true,
    target: 'chrome90',
  },
});
