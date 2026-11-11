import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TorrServerClient } from '../../src/api/torrserver';
import { addServer, removeServer, setActiveServer } from '../../src/store/servers';
import { native } from '../src/platform/native';
import { readPhoneTorr } from '../src/server/componentProbe';

describe('readPhoneTorr', () => {
  let id = '';
  beforeEach(() => {
    const s = addServer({ name: 'NAS', url: 'http://192.168.1.20:8090' });
    id = s.id;
    setActiveServer(id);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setActiveServer(null);
    if (id) removeServer(id);
  });

  it('stays quiet when the selected remote server does not answer', async () => {
    vi.spyOn(TorrServerClient.prototype, 'echo').mockRejectedValue(new Error('down'));
    const info = vi.spyOn(native, 'localServerInfo').mockResolvedValue({
      supported: true,
      running: false,
      binary: 'ready',
      pinVersion: 'MatriX.150',
    });
    expect(await readPhoneTorr()).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it('reports the remote version and not the embedded pin', async () => {
    vi.spyOn(TorrServerClient.prototype, 'echo').mockResolvedValue('MatriX.149');
    vi.spyOn(native, 'localServerInfo').mockResolvedValue({
      supported: true,
      running: false,
      binary: 'ready',
      pinVersion: 'MatriX.150',
    });
    expect(await readPhoneTorr()).toEqual({ version: 'MatriX.149', source: 'remote' });
  });
});
