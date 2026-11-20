// Rewrite the version files a release PR commits. Does not tag or push.
import { readFileSync, writeFileSync } from 'node:fs';
import { replaceCargoVersion, replaceVersionFields, webosVersion } from './omp-version.mjs';

export function rewriteReleaseVersionFiles(from, to) {
  if (from === to) return;
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.version !== from) throw new Error(`package.json is ${pkg.version}, expected ${from}`);
  pkg.version = to;
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

  const rewrite = (path, expected) => {
    const text = readFileSync(path, 'utf8');
    const next = path.endsWith('.toml') || path.endsWith('.lock')
      ? replaceCargoVersion(text, from, to, expected)
      : replaceVersionFields(text, from, to, expected);
    writeFileSync(path, next);
  };
  rewrite('package-lock.json', 2);
  rewrite('desktop/package.json', 1);
  rewrite('desktop/package-lock.json', 2);
  rewrite('desktop/src-tauri/tauri.conf.json', 1);
  rewrite('desktop/src-tauri/Cargo.toml', 1);
  rewrite('desktop/src-tauri/Cargo.lock', 1);

  const appinfoPath = 'webos/appinfo.json';
  const appinfo = JSON.parse(readFileSync(appinfoPath, 'utf8'));
  const web = webosVersion(to);
  if (appinfo.version !== web) {
    const raw = readFileSync(appinfoPath, 'utf8');
    writeFileSync(appinfoPath, replaceVersionFields(raw, appinfo.version, web, 1));
  }
}
