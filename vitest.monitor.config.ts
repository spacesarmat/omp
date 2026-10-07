// The live parser monitor (npm run monitor:parsers): the real parsers against the live sites. Not part of `npm test`
// (that one never touches the network). See docs/parser-monitor.md.
import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __TORRSERVER_VERSION__: JSON.stringify(readFileSync('torrserver.version', 'utf8').trim()),
  },
  test: {
    environment: 'node',
    include: ['scripts/parser-monitor/run.live.ts'],
    setupFiles: ['scripts/parser-monitor/setup.mjs'],
    testTimeout: 40 * 60 * 1000,
    hookTimeout: 60 * 1000,
    // the progress lines and the table are the output
    silent: false,
  },
});
