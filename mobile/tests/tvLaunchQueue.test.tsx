import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEffect } from 'preact/hooks';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { setWatchActions, useTvLaunch, type TvLaunchOpts } from '../src/watch';
import { addServer, removeServer, servers, setActiveServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { TorrServerClient } from '../../src/api/torrserver';
import type { TorrentFile } from '../../src/lib/episodes';

const launch = vi.fn().mockResolvedValue(undefined);

function Probe({ run }: { run: (start: (o: TvLaunchOpts) => Promise<boolean>) => void }) {
  const { start } = useTvLaunch();
  useEffect(() => {
    run(start);
  }, []);
  return null;
}

async function launchOf(opts: TvLaunchOpts) {
  let start: ((o: TvLaunchOpts) => Promise<boolean>) | null = null;
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => {
    render(<Probe run={(s) => { start = s; }} />, el);
  });
  if (!start) throw new Error('launch did not mount');
  await act(async () => {
    await start!(opts);
  });
  return launch.mock.calls[launch.mock.calls.length - 1][0];
}

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [];
  saveTv({ ip: '192.168.1.5', name: 'LG' });
  launch.mockClear().mockResolvedValue(undefined);
  setWatchActions({
    ompVersion: async () => null,
    reportUrl: async () => null,
    launchOnTv: launch,
    phoneName: async () => 'Phone',
    recordWatch: async () => undefined,
    localIpv4: async () => '10.0.0.2',
    remoteDelayMs: 0,
  });
});

afterEach(() => {
  setWatchActions(null);
  vi.restoreAllMocks();
});

describe('TV launch queue', () => {
  it('builds the season queue from the server when the torrent is not in the library', async () => {
    const file_stats: TorrentFile[] = [
      { id: 1, path: 'Show.S01E01.mkv', length: 1 },
      { id: 9, path: 'Show.S01E01.Director.mkv', length: 1 },
      { id: 2, path: 'Show.S01E02.5.mkv', length: 1 },
      { id: 3, path: 'Show.S01E03.mkv', length: 1 },
      { id: 4, path: 'Season 2/Show - 02.mkv', length: 1 },
    ];
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue({ hash: 'abc', title: 'Show', file_stats } as any);
    const sent = await launchOf({ hash: 'abc', file: 9, label: 'copy' });
    expect(sent.file).toBe(9);
    expect(sent.files).toEqual([9]);
    expect(sent.files).not.toContain(2);
    expect(sent.files).not.toContain(4);
  });

  it('does not cut a later season with the count of the season on screen', async () => {
    const file_stats: TorrentFile[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
      id: n,
      path: 'Show.S02E' + (n < 10 ? '0' : '') + n + '.mkv',
      length: 1,
    }));
    const sent = await launchOf({
      hash: 'abc',
      file: 3,
      label: 'S02E03',
      season: 1,
      seasonTotal: 6,
      files: file_stats,
    });
    expect(sent.files).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('a film is sent as that one file, so extras do not follow', async () => {
    const sent = await launchOf({
      hash: 'mov',
      file: 1,
      label: 'Movie',
      files: [
        { id: 1, path: 'Movie.2020.mkv', length: 1 },
        { id: 2, path: 'Movie.2020.extra.mkv', length: 1 },
      ],
    });
    expect(sent.files).toEqual([1]);
  });

  it('a launch with no file does not invent a season queue', async () => {
    const sent = await launchOf({ hash: 'abc', label: 'Added' });
    expect(sent.files).toBeUndefined();
    expect(sent.file).toBeUndefined();
  });

  it('loads files for a library row that has none yet', async () => {
    torrents.value = [{ hash: 'abc', title: 'Show S01', category: 'tv' } as any];
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue({
      hash: 'abc',
      title: 'Show',
      file_stats: [
        { id: 1, path: 'Show.S01E01.mkv', length: 1 },
        { id: 3, path: 'Show.S01E03.mkv', length: 1 },
      ],
    } as any);
    const sent = await launchOf({ hash: 'abc', file: 1, label: 'E01' });
    expect(sent.files).toEqual([1]);
  });

  it('leaves the queue off when the server has no files', async () => {
    vi.spyOn(TorrServerClient.prototype, 'get').mockRejectedValue(new Error('down'));
    const sent = await launchOf({ hash: 'abc', file: 1, label: 'x' });
    expect(sent.file).toBe(1);
    expect(sent.files).toBeUndefined();
  });
});
