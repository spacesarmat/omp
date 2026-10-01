import { describe, it, expect, beforeEach } from 'vitest';
import { servers, activeServerId, activeServer, client, addServer, removeServer, setActiveServer, requireClient } from '../../src/store/servers';

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
