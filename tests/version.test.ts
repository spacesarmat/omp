import { describe, it, expect } from 'vitest';
import pkgRaw from '../package.json?raw';
import { APP_VERSION } from '../src/version';

describe('APP_VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(pkgRaw);
    expect(APP_VERSION).toBe(pkg.version);
  });
});
