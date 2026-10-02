import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import legacy from '@vitejs/plugin-legacy';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// file:// has origin "null": crossorigin script tags get blocked by CORS in Chrome
const stripCrossorigin = () => ({
  name: 'webos-strip-crossorigin',
  apply: 'build' as const,
  enforce: 'post' as const,
  writeBundle(opts: { dir?: string }) {
    const f = join(opts.dir || 'dist', 'index.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/\s+crossorigin(="[^"]*")?/g, ''));
  },
});

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    preact(),
    legacy({
      targets: ['chrome >= 53'],
      renderModernChunks: false,
    }),
    stripCrossorigin(),
  ],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
