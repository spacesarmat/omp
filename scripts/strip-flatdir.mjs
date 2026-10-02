// After `cap sync android`: drop the flatDir repository Capacitor writes into the Cordova plugins module.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stripFlatDir } from './flatdir-lib.mjs';

const file = 'android/capacitor-cordova-android-plugins/build.gradle';
if (existsSync(file)) {
  const text = readFileSync(file, 'utf8');
  const next = stripFlatDir(text);
  if (next !== text) {
    writeFileSync(file, next);
    console.log('removed flatDir from ' + file);
  }
}
