import { describe, expect, it } from 'vitest';
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
  });
});
