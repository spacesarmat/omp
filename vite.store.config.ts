// LG Content Store variant of the webOS TV app: the same player for the user's own TorrServer, but with public
// torrent search and discovery gated off (src/storeMode.ts). Homebrew Channel and Developer Mode are replaced
// with empty modules so those Luna calls are not in the ipk. Build: npm run build:store, then package dist-store.
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

const stub = (name: string) => fileURLToPath(new URL(`./src/platform/${name}.store.ts`, import.meta.url));

export default mergeConfig(
  base,
  defineConfig({
    define: {
      __STORE_BUILD__: JSON.stringify(true),
    },
    resolve: {
      alias: [
        // Match the whole import id. A shorter match would leave the "../" in front of the absolute path.
        { find: /^(?:.*\/)?platform\/hbchannel$/, replacement: stub('hbchannel') },
        { find: /^(?:.*\/)?platform\/devmode$/, replacement: stub('devmode') },
      ],
    },
    build: {
      outDir: 'dist-store',
    },
  }),
);