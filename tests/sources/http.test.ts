import { describe, it, expect, vi } from 'vitest';
import { createSourceHttp, createSecretStore } from '../../src/sources/http';

describe('createSourceHttp', () => {
  it('get and post call the native http with the right shape', async () => {
    const call = vi.fn((_o: unknown) => Promise.resolve({ status: 200, url: 'https://s/final', text: '<html>' }));
    const http = createSourceHttp(call);
    expect(await http.get('https://s/a', { headers: { Referer: 'https://s/' }, timeoutMs: 5000 })).toEqual({ status: 200, url: 'https://s/final', text: '<html>' });
    expect(call).toHaveBeenLastCalledWith({ url: 'https://s/a', method: 'GET', headers: { Referer: 'https://s/' }, timeoutMs: 5000 });
    await http.post('https://s/login', { login: 'u', pass: 'p' }, { formCharset: 'windows-1251' });
    expect(call).toHaveBeenLastCalledWith({ url: 'https://s/login', method: 'POST', form: { login: 'u', pass: 'p' }, formCharset: 'windows-1251' });
  });

  it('rejects non-http URLs before calling native', async () => {
    const call = vi.fn();
    const http = createSourceHttp(call);
    await expect(http.get('file:///data/x')).rejects.toThrow('Неверный адрес');
    await expect(http.post('javascript:alert(1)', {})).rejects.toThrow('Неверный адрес');
    expect(call).not.toHaveBeenCalled();
  });

  it('normalizes a malformed native answer', async () => {
    const http = createSourceHttp(() => Promise.resolve({ status: '200', text: 5 }));
    expect(await http.get('http://s/')).toEqual({ status: 0, url: 'http://s/', text: '' });
  });

  it('clearCookies passes the url; without native support it resolves', async () => {
    const clear = vi.fn(() => Promise.resolve());
    const http = createSourceHttp(() => Promise.resolve({}), clear);
    await http.clearCookies('https://rutracker.org/forum/');
    expect(clear).toHaveBeenCalledWith('https://rutracker.org/forum/');
    await expect(createSourceHttp(() => Promise.resolve({})).clearCookies('https://x/')).resolves.toBeUndefined();
  });
});

describe('createSecretStore', () => {
  it('maps get / set / delete', async () => {
    const store: { [k: string]: string } = {};
    const s = createSecretStore({
      get: (key) => Promise.resolve({ value: key in store ? store[key] : null }),
      set: (key, value) => { store[key] = value; return Promise.resolve(); },
      delete: (key) => { delete store[key]; return Promise.resolve(); },
    });
    expect(await s.get('a')).toBeNull();
    await s.set('a', 'секрет');
    expect(await s.get('a')).toBe('секрет');
    await s.delete('a');
    expect(await s.get('a')).toBeNull();
  });
});
