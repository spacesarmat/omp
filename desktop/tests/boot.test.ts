import { describe, expect, it } from 'vitest';
import { desktopRuntimeInstructions, TargetPlatform } from '../src/platform/platform';

describe('desktop platform', () => {
  it('lists Windows, macOS and Linux targets', () => {
    expect(Object.values(TargetPlatform)).toEqual(['windows-x64', 'macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64']);
  });

  it('explains the WebView2 runtime requirement', () => {
    expect(desktopRuntimeInstructions()).toContain('WebView2');
    expect(desktopRuntimeInstructions()).toContain('https://');
  });
});
