import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  root: 'mobile',
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [preact()],
  build: {
    outDir: '../dist-mobile',
    emptyOutDir: true,
    target: 'chrome90',
  },
});
