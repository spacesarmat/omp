import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';

describe('Chromium 66 bundle target', () => {
  it('ships the Android TV bundle transpiled for a WebView older than 66', () => {
    const src = readFileSync('vite.tv-android.config.ts', 'utf8');
    const m = src.match(/target:\s*'chrome(\d+)'/);
    expect(m).not.toBeNull();
    expect(Number(m && m[1])).toBeLessThanOrEqual(66);
  });

  it('transpiles the webOS bundle with the legacy plugin for Chrome 53', () => {
    const src = readFileSync('vite.config.ts', 'utf8');
    expect(src).toContain("targets: ['chrome >= 53']");
    expect(src).toContain('renderModernChunks: false');
  });
});
