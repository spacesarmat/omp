// LG Content Store variant of the webOS TV app: the same player for the user's own TorrServer, but with public
// torrent search and discovery gated off (src/storeMode.ts). Build: npm run build:store, then package dist-store.
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(
  base,
  defineConfig({
    define: {
      __STORE_BUILD__: JSON.stringify(true),
    },
    build: {
      outDir: 'dist-store',
    },
  }),
);