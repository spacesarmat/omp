import { describe, expect, it } from 'vitest';
import { createBridge } from '../src/platform/bridge';
import { createDesktopNative } from '../src/platform/native';
import { createUpdateApi, updateInfoFromPackage, type UpdateInfo } from '../src/platform/update';

const candidate: UpdateInfo = {
  version: '0.20.11',
  url: 'https://github.com/spacesarmat/omp/releases/download/v0.20.11/OMP-0.20.11-setup.exe',
  sha256: 'a'.repeat(64),
  notes: ['Desktop update'],
};

describe('desktop update API', () => {
  it('forwards check, download and apply through typed IPC', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const api = createUpdateApi(createBridge(async (command, args) => {
      calls.push({ command, args });
      return command === 'update_check' ? candidate : command === 'update_download' ? candidate : undefined;
    }));

    await expect(api.updateCheck(candidate)).resolves.toEqual(candidate);
    await expect(api.updateDownload(candidate)).resolves.toEqual(candidate);
    await api.updateApply(candidate);

    expect(calls).toEqual([
      { command: 'update_check', args: { info: candidate } },
      { command: 'update_download', args: { info: candidate } },
      { command: 'update_apply', args: { info: candidate } },
    ]);
  });

  it('connects the existing update sheet to the NSIS installer', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const progress: number[] = [];
    const userAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { value: 'Windows NT 10.0', configurable: true });
    const desktop = createDesktopNative(createBridge(async (command, args) => {
      calls.push({ command, args });
      return command === 'update_download' ? candidate : command === 'update_supported' ? true : undefined;
    }));

    await expect(desktop.native.canInstallApks()).resolves.toBe(true);
    await desktop.native.downloadAndInstallApk(candidate.url, candidate.sha256, (percent) => progress.push(percent));

    const installInfo = { ...candidate, notes: [] };
    expect(calls).toEqual([
      { command: 'update_supported', args: undefined },
      { command: 'update_download', args: { info: installInfo } },
      { command: 'update_apply', args: { info: installInfo } },
    ]);
    expect(progress).toEqual([50, 100]);
    Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  });

  it('reads a pending update result through typed IPC', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const api = createUpdateApi(createBridge(async (command, args) => {
      calls.push({ command, args });
      return { status: 'error', message: 'NSIS installation failed' };
    }));

    await expect(api.takePendingUpdateResult()).resolves.toEqual({
      status: 'error',
      message: 'NSIS installation failed',
    });
    expect(calls).toEqual([{ command: 'update_pending_result', args: undefined }]);
  });

  it('parses a versioned NSIS package and rejects another package type', () => {
    expect(updateInfoFromPackage(candidate.url, candidate.sha256)).toEqual({
      version: '0.20.11',
      url: candidate.url,
      sha256: candidate.sha256,
      notes: [],
    });
    expect(() => updateInfoFromPackage('https://example.com/OMP-0.20.11.msix', candidate.sha256))
      .toThrow('invalid update package version');
    expect(updateInfoFromPackage('https://example.com/OMP-0.20.12-beta.2-macos-arm64.dmg', candidate.sha256).version).toBe('0.20.12-beta.2');
    expect(updateInfoFromPackage('https://example.com/OMP-0.20.12-linux-x64.AppImage', candidate.sha256).version).toBe('0.20.12');
  });
});
