import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkgRaw from '../package.json?raw';
import desktopPkgRaw from '../desktop/package.json?raw';
import tauriConfRaw from '../desktop/src-tauri/tauri.conf.json?raw';
import cargoTomlRaw from '../desktop/src-tauri/Cargo.toml?raw';
import { APP_VERSION } from '../src/version';

describe('APP_VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(pkgRaw);
    expect(APP_VERSION).toBe(pkg.version);
  });
  it('keeps the desktop UI, package, Tauri and Cargo on one desktop version', () => {
    const desktopVersion = JSON.parse(desktopPkgRaw).version;
    expect(JSON.parse(tauriConfRaw).version).toBe(desktopVersion);
    expect(cargoTomlRaw).toContain(`version = "${desktopVersion}"`);
    const testDir = dirname(fileURLToPath(import.meta.url));
    const viteConfig = readFileSync(join(testDir, '../desktop/vite.config.ts'), 'utf8');
    // the desktop UI gets its version from desktop/package.json, independent of the root package
    expect(viteConfig).toContain("new URL('./package.json', import.meta.url)");
    expect(viteConfig).not.toContain("'../package.json'");
  });
});
