import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { phoneRpc, setRpcTransport, phoneStatus, PhoneRpcError } from '../../src/phone/rpc';
import { savePhoneLink, forgetPhoneLink } from '../../src/phone/phoneStore';

const PH = { url: 'http://192.168.1.20:8097', token: 'a'.repeat(32), name: 'Pixel' };
beforeEach(() => savePhoneLink(PH));
afterEach(() => { setRpcTransport(null); forgetPhoneLink(); phoneStatus.value = 'unknown'; });

it('posts to the token path and unwraps ok', async () => {
  const seen: string[] = [];
  setRpcTransport((url, body, ms) => { seen.push(url, body, String(ms)); return Promise.resolve('{"ok":true,"result":{"x":1}}'); });
  expect(await phoneRpc('sources')).toEqual({ x: 1 });
  expect(seen).toEqual([PH.url + '/omp/' + PH.token + '/rpc', '{"method":"sources","params":{}}', '5000']);
  expect(phoneStatus.value).toBe('online');
});
it('maps phone errors and network failures', async () => {
  setRpcTransport(() => Promise.resolve('{"ok":false,"error":{"code":"expired"}}'));
  await expect(phoneRpc('searchPoll', { handle: 'h' })).rejects.toMatchObject({ code: 'expired' });
  setRpcTransport(() => Promise.reject(new Error('timeout')));
  await expect(phoneRpc('sources')).rejects.toMatchObject({ code: 'timeout' });
  expect(phoneStatus.value).toBe('offline');
  setRpcTransport(() => Promise.resolve('<html>'));
  await expect(phoneRpc('sources')).rejects.toMatchObject({ code: 'unreachable' });
});
it('no phone => nophone without a request', async () => {
  forgetPhoneLink();
  const t = vi.fn(); setRpcTransport(t);
  await expect(phoneRpc('sources')).rejects.toBeInstanceOf(PhoneRpcError);
  expect(t).not.toHaveBeenCalled();
});

describe('more', () => {
  it('not_ready and an HTTP error mark the phone offline; an error answer keeps it online', async () => {
    setRpcTransport(() => Promise.resolve('{"ok":false,"error":{"code":"not_ready"}}'));
    await expect(phoneRpc('sources')).rejects.toMatchObject({ code: 'not_ready' });
    expect(phoneStatus.value).toBe('offline');
    setRpcTransport(() => Promise.resolve('{"ok":false,"error":{"code":"failed","message":"boom"}}'));
    await expect(phoneRpc('resolve')).rejects.toMatchObject({ code: 'failed', message: 'boom' });
    expect(phoneStatus.value).toBe('online');
    setRpcTransport(() => Promise.reject(new Error('http 404')));
    await expect(phoneRpc('sources')).rejects.toMatchObject({ code: 'unreachable' });
    expect(phoneStatus.value).toBe('offline');
  });
  it('an unknown error code becomes failed; a reply without ok is unreachable', async () => {
    setRpcTransport(() => Promise.resolve('{"ok":false,"error":{"code":"weird"}}'));
    await expect(phoneRpc('sources')).rejects.toMatchObject({ code: 'failed' });
    setRpcTransport(() => Promise.resolve('{"result":1}'));
    await expect(phoneRpc('sources')).rejects.toMatchObject({ code: 'unreachable' });
  });
  it('sends the params and is a real PhoneRpcError', async () => {
    let body = '';
    setRpcTransport((_u, b) => { body = b; return Promise.resolve('{"ok":false,"error":{"code":"bad_request"}}'); });
    const e = await phoneRpc('search', { query: 'Dune' }).catch((x) => x);
    expect(e).toBeInstanceOf(PhoneRpcError);
    expect(e).toBeInstanceOf(Error);
    expect(JSON.parse(body)).toEqual({ method: 'search', params: { query: 'Dune' } });
  });
});
