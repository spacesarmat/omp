import { describe, it, expect, beforeEach } from 'vitest';
import { serverViewed } from '../../src/store/progress';
import { torrents } from '../../src/store/library';
import { servers, activeServerId, activeServer, client, addServer, removeServer, setActiveServer, requireClient, updateServer, serverLabel, serverHost } from '../../src/store/servers';

beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
});

describe('servers store', () => {
  it('adds with normalized url and dedups', () => {
    const a = addServer({ url: '192.168.1.191:5665' });
    expect(a.url).toBe('http://192.168.1.191:5665');
    expect(a.name).toBe('192.168.1.191:5665');
    const b = addServer({ url: 'http://192.168.1.191:5665/', name: 'Дом' });
    expect(b.id).toBe(a.id);
    expect(servers.value).toHaveLength(1);
    expect(servers.value[0].name).toBe('Дом');
    expect(JSON.parse(localStorage.getItem('tsp.servers')!)).toHaveLength(1);
  });
  it('sets active and builds client', () => {
    const a = addServer({ url: '10.0.0.2' });
    setActiveServer(a.id);
    expect(activeServer.value!.id).toBe(a.id);
    expect(client.value!.baseUrl).toBe('http://10.0.0.2:8090');
    expect(requireClient().baseUrl).toBe('http://10.0.0.2:8090');
    expect(JSON.parse(localStorage.getItem('tsp.activeServer')!)).toBe(a.id);
  });
  it('removing active clears it', () => {
    const a = addServer({ url: '10.0.0.2' });
    setActiveServer(a.id);
    removeServer(a.id);
    expect(activeServer.value).toBeNull();
    expect(() => requireClient()).toThrow();
  });
});

describe('server-scoped state', () => {
  it('keeps credentials when re-adding without them', () => {
    const a = addServer({ url: 'h:1', user: 'u', password: 'p' });
    const b = addServer({ url: 'h:1', name: 'Дом' });
    expect(b.id).toBe(a.id);
    expect(b.user).toBe('u');
    expect(b.password).toBe('p');
    const c = addServer({ url: 'h:1', user: 'v', password: 'q' });
    expect(c.user).toBe('v');
    expect(c.password).toBe('q');
  });
  it('clears viewed marks and library cache when switching servers', () => {
    const a = addServer({ url: 'h:1' });
    const b = addServer({ url: 'h:2' });
    setActiveServer(a.id);
    torrents.value = [{ hash: 'x', title: 'X', stat: 5 }];
    serverViewed.value = [{ hash: 'x', file_index: 1 }];
    setActiveServer(a.id);
    expect(torrents.value).toHaveLength(1);
    setActiveServer(b.id);
    expect(torrents.value).toEqual([]);
    expect(serverViewed.value).toEqual([]);
    expect(JSON.parse(localStorage.getItem('tsp.torrents')!)).toEqual([]);
  });
});

describe('updateServer', () => {
  it('renames, changes url and credentials', () => {
    const a = addServer({ url: 'h:1', user: 'u', password: 'p' });
    expect(updateServer(a.id, { name: ' Дом ', url: 'h:2', user: '', password: 'x y' })).toBe('ok');
    const s = servers.value[0];
    expect(s.name).toBe('Дом');
    expect(s.url).toBe('http://h:2');
    expect(s.user).toBeUndefined();
    expect(s.password).toBe('x y');
    expect(JSON.parse(localStorage.getItem('tsp.servers')!)[0].name).toBe('Дом');
  });
  it('keeps the old name when the new one is blank', () => {
    const a = addServer({ url: 'h:1', name: 'Старое' });
    updateServer(a.id, { name: '  ' });
    expect(servers.value[0].name).toBe('Старое');
  });
  it('rejects a duplicate url and unknown ids', () => {
    const a = addServer({ url: 'h:1' });
    addServer({ url: 'h:2' });
    expect(updateServer(a.id, { url: 'http://h:2/' })).toBe('duplicate');
    expect(servers.value[0].url).toBe('http://h:1');
    expect(updateServer('nope', { name: 'x' })).toBe('missing');
  });
  it('clears server-scoped data when the active server moves', () => {
    const a = addServer({ url: 'h:1' });
    setActiveServer(a.id);
    torrents.value = [{ hash: 'x', title: 'X', stat: 5 }];
    serverViewed.value = [{ hash: 'x', file_index: 1 }];
    updateServer(a.id, { name: 'Дом' });
    expect(torrents.value).toHaveLength(1);
    updateServer(a.id, { url: 'h:9' });
    expect(torrents.value).toEqual([]);
    expect(serverViewed.value).toEqual([]);
    expect(client.value!.baseUrl).toBe('http://h:9');
  });
});

describe('serverLabel', () => {
  it('a server named after its address is shown once; a real name with the address', () => {
    expect(serverLabel({ name: '192.168.1.191:5665', url: 'http://192.168.1.191:5665' })).toBe('192.168.1.191:5665');
    expect(serverLabel({ name: 'http://192.168.1.191:5665/', url: 'http://192.168.1.191:5665' })).toBe('192.168.1.191:5665');
    expect(serverLabel({ name: '192.168.1.191:5665', url: 'https://192.168.1.191:5665/' })).toBe('192.168.1.191:5665');
    expect(serverLabel({ name: 'Дом', url: 'http://192.168.1.191:5665' })).toBe('Дом · 192.168.1.191:5665');
    expect(serverLabel({ name: '', url: 'http://10.0.0.2:8090' })).toBe('10.0.0.2:8090');
    expect(serverHost('HTTP://Box.local:8090//')).toBe('Box.local:8090');
  });
});
