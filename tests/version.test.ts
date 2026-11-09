import { describe, it, expect } from 'vitest';
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
  it('uses one version for the desktop page, package and native check', () => {
    expect(JSON.parse(desktopPkgRaw).version).toBe(APP_VERSION);
    expect(JSON.parse(tauriConfRaw).version).toBe(APP_VERSION);
    expect(cargoTomlRaw).toContain(`version = "${APP_VERSION}"`);
  });
});
