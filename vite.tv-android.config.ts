import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const torrserverVersion = readFileSync('torrserver.version', 'utf8').trim();

// TV interface bundle shipped inside the Android APK: served at <localUrl>/tv/index.html
export default defineConfig({
  root: '.',
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __TORRSERVER_VERSION__: JSON.stringify(torrserverVersion),
    __TMDB_FALLBACK_KEY__: JSON.stringify(process.env.TMDB_API_KEY || ''),
  },
  plugins: [preact()],
  build: {
    outDir: 'dist-mobile/tv',
    emptyOutDir: true,
    // Dune HD and other Android 9 boxes ship WebView 66. chrome61 transpiles ?. / ?? and stays inside that.
    target: 'chrome61',
    assetsInlineLimit: 0,
  },
});
