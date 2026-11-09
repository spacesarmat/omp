import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createBridge } from '../src/platform/bridge';
import { createDesktopNative } from '../src/platform/native';
import { createUpdateApi, type UpdateInfo } from '../src/platform/update';

const candidate: UpdateInfo = {
  version: '0.20.11',
  url: 'https://github.com/spacesarmat/omp/releases/download/v0.20.11/OMP-0.20.11.msix',
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

  it('connects the existing update sheet to the MSIX installer', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const progress: number[] = [];
    const userAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { value: 'Windows NT 10.0', configurable: true });
    const desktop = createDesktopNative(createBridge(async (command, args) => {
      calls.push({ command, args });
      return command === 'update_download' ? candidate : undefined;
    }));

    await expect(desktop.native.canInstallApks()).resolves.toBe(true);
    await desktop.native.downloadAndInstallApk(candidate.url, candidate.sha256, (percent) => progress.push(percent));

    const installInfo = { ...candidate, notes: [] };
    expect(calls).toEqual([
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
      return { status: 'error', message: 'MSIX installation failed' };
    }));

    await expect(api.takePendingUpdateResult()).resolves.toEqual({
      status: 'error',
      message: 'MSIX installation failed',
    });
    expect(calls).toEqual([{ command: 'update_pending_result', args: undefined }]);
  });

  it.skipIf(process.platform !== 'win32')('maps beta and stable versions to increasing MSIX versions', () => {
    const script = path.resolve('desktop/packaging/windows/build.ps1');
    const versions = {
      '0.2.0-beta.1': '0.2.0.1',
      '0.2.0-beta.2': '0.2.0.2',
      '0.2.0': '0.2.0.65535',
    };
    for (const [version, expected] of Object.entries(versions)) {
      const actual = execFileSync('powershell.exe', [
        '-NoProfile', '-File', script, '-VersionOverride', version, '-PrintVersionOnly',
      ], { encoding: 'utf8' }).trim();
      expect(actual).toBe(expected);
    }
  });
});
