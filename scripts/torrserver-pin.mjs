// Checks the pinned TorrServer download (res/raw/torrserver.json) against torrserver.version. Offline: the binary is
// no longer packed into the APK, the app downloads it on demand. Also removes a libtorrserver.so left in jniLibs by
// earlier builds, so it cannot slip back into the APK.
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersionFile, parsePin, PIN_PATH, LEGACY_LIB } from './torrserver-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tag = parseVersionFile(readFileSync(join(root, 'torrserver.version'), 'utf8'));
const pin = parsePin(readFileSync(join(root, PIN_PATH), 'utf8'), tag);
const legacy = join(root, LEGACY_LIB);
if (existsSync(legacy)) {
  rmSync(legacy, { force: true });
  console.log('removed the old bundled libtorrserver.so / удалён старый libtorrserver.so');
}
console.log(`TorrServer pin ${pin.tag} (${pin.size} bytes) ok`);
