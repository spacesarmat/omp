import { describe, it, expect, beforeEach, vi } from 'vitest';

const connect = vi.hoisted(() => vi.fn());
const attach = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../src/connect/connectServer', () => ({
  connectServer: (...args: unknown[]) => connect(...args),
}));
vi.mock('../src/tv/playerLink', () => ({
  attachIfOmpForeground: () => attach(),
}));

import { applyPairUrl } from '../src/share/pairOpen';
import { buildPairUri } from '../../src/lib/pairing';
import { currentRoute, resetTo } from '../src/nav';
import { reloadTvs, saveTv, setActiveTv } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';

beforeEach(() => {
  connect.mockReset();
  attach.mockClear();
  localStorage.clear();
  reloadTvs();
  resetTo({ name: 'library' });
  toast.value = '';
});

describe('pairing link from the TV QR', () => {
  it('connects the server from the https link and opens the TV screen', async () => {
    connect.mockResolvedValue({ ok: true, server: { id: 's', url: 'http://192.168.1.10:8090', name: 'Дом' }, version: '1' });
    const url = buildPairUri({ url: 'http://192.168.1.10:8090', name: 'Дом', user: 'admin', password: 'secret' });
    expect(await applyPairUrl(url)).toBe(true);
    expect(connect).toHaveBeenCalledWith({ name: 'Дом', url: 'http://192.168.1.10:8090', user: 'admin', password: 'secret' });
    expect(currentRoute.value).toEqual({ name: 'tv' });
    expect(toast.value).toContain('Дом');
    expect(attach).not.toHaveBeenCalled();
  });

  it('links the remote when a TV is already chosen', async () => {
    saveTv({ ip: '192.168.1.20', name: 'LG', clientKey: 'k' });
    setActiveTv('192.168.1.20');
    connect.mockResolvedValue({ ok: true, server: { id: 's', url: 'http://h:1', name: 'h:1' }, version: '1' });
    expect(await applyPairUrl(buildPairUri({ url: 'http://h:1' }))).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(currentRoute.value.name).toBe('library');
  });

  it('ignores a title link and reports a failed connect', async () => {
    expect(await applyPairUrl('https://omp-player.online/t/movie/11')).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    connect.mockResolvedValue({ ok: false, error: 'нет сети', network: true });
    expect(await applyPairUrl('omp://pair?v=1&url=' + encodeURIComponent('http://h:1'))).toBe(true);
    expect(toast.value).toBe('нет сети');
    expect(currentRoute.value.name).toBe('library');
  });
});
