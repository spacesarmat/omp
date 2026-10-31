import { describe, expect, it, beforeEach } from 'vitest';
import { addServer, setActiveServer, servers, activeServerId } from '../src/store/servers';
import { currentRoute, resetTo } from '../src/ui/nav';
import { flushTvTitleLink, queueTvTitleLink, resetTvTitleLink } from '../src/titleLink';

beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  resetTvTitleLink();
  resetTo({ name: 'library' });
});

describe('Android TV title links', () => {
  it('opens the film card once a server is connected', () => {
    expect(queueTvTitleLink('https://omp-player.online/t/movie/11')).toBe(true);
    flushTvTitleLink();
    expect(currentRoute.value.name).toBe('library');
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    flushTvTitleLink();
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'movie', id: 11 });
  });

  it('opens the series card for a season link and ignores a magnet', () => {
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    expect(queueTvTitleLink('https://omp-player.online/t/tv/21/s/2')).toBe(true);
    flushTvTitleLink();
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'tv', id: 21 });
    resetTo({ name: 'library' });
    expect(queueTvTitleLink('magnet:?xt=urn:btih:' + 'ab'.repeat(20))).toBe(false);
    flushTvTitleLink();
    expect(currentRoute.value.name).toBe('library');
  });

  it('waits on the connect screen', () => {
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    resetTo({ name: 'connect' });
    queueTvTitleLink('omp://t/tv/9/s/1');
    flushTvTitleLink();
    expect(currentRoute.value.name).toBe('connect');
    resetTo({ name: 'library' });
    flushTvTitleLink();
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'tv', id: 9 });
  });
});
