import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachPhone, detachPhone, postSoon, phoneAttached, setLinkTransport, setPlayerBridge } from '../../src/phone/link';
import type { Cmd } from '../../src/phone/protocol';
import { APP_VERSION } from '../../src/version';

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  detachPhone();
  setLinkTransport(null);
  vi.useRealTimers();
});

describe('phone link', () => {
  it('posts null state without a bridge, on the interval', async () => {
    const calls: { url: string; body: string }[] = [];
    setLinkTransport((url, body) => {
      calls.push({ url, body });
      return Promise.resolve('{"cmds":[]}');
    });
    attachPhone('http://p:1/r');
    expect(phoneAttached.value).toBe(true);
    await tick(499);
    expect(calls.length).toBe(0);
    await tick(1);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('http://p:1/r');
    expect(JSON.parse(calls[0].body)).toEqual({ v: 1, app: APP_VERSION, state: null });
    await tick(500);
    expect(calls.length).toBe(2);
  });

  it('posts the bridge snapshot and executes commands in order, then posts soon', async () => {
    const calls: string[] = [];
    let n = 0;
    setLinkTransport((_u, body) => {
      calls.push(body);
      n++;
      return Promise.resolve(
        n === 1 ? '{"cmds":[{"id":1,"type":"pause"},{"id":2,"type":"bogus"},{"id":3,"type":"seek","t":5}]}' : '{"cmds":[]}',
      );
    });
    const ran: Cmd[] = [];
    const snap = { hash: 'x' } as never;
    const off = setPlayerBridge({ snapshot: () => snap, exec: (c) => ran.push(c) });
    attachPhone('http://p:1/r');
    await tick(500);
    expect(JSON.parse(calls[0]).state).toEqual({ hash: 'x' });
    expect(ran).toEqual([{ id: 1, type: 'pause' }, { id: 3, type: 'seek', t: 5 }]);
    await tick(1);
    expect(calls.length).toBe(2);
    off();
    await tick(500);
    expect(JSON.parse(calls[2]).state).toBeNull();
  });

  it('never has two requests in flight', async () => {
    let count = 0;
    let release: (s: string) => void = () => {};
    setLinkTransport(() => {
      count++;
      return new Promise<string>((r) => (release = r));
    });
    attachPhone('http://p:1/r');
    await tick(2000);
    expect(count).toBe(1);
    release('{}');
    await tick(500);
    expect(count).toBe(2);
  });

  it('drops after 20 s without a successful response', async () => {
    setLinkTransport(() => Promise.reject(new Error('net')));
    attachPhone('http://p:1/r');
    await tick(19500);
    expect(phoneAttached.value).toBe(true);
    await tick(1000);
    expect(phoneAttached.value).toBe(false);
  });

  it('bad JSON counts as a failure; a success resets the timer', async () => {
    let mode = 'bad';
    setLinkTransport(() => Promise.resolve(mode === 'bad' ? 'nope' : '{}'));
    attachPhone('http://p:1/r');
    await tick(15000);
    mode = 'ok';
    await tick(1000);
    mode = 'bad';
    await tick(15000);
    expect(phoneAttached.value).toBe(true);
    await tick(6000);
    expect(phoneAttached.value).toBe(false);
  });

  it('retargeting replaces the url and resets the drop timer', async () => {
    const urls: string[] = [];
    setLinkTransport((u) => {
      urls.push(u);
      return Promise.reject(new Error('net'));
    });
    attachPhone('http://a/r');
    await tick(15000);
    attachPhone('http://b/r');
    await tick(15000);
    expect(phoneAttached.value).toBe(true);
    expect(urls[urls.length - 1]).toBe('http://b/r');
    await tick(6000);
    expect(phoneAttached.value).toBe(false);
  });

  it('postSoon posts immediately and coalesces', async () => {
    let count = 0;
    setLinkTransport(() => {
      count++;
      return Promise.resolve('{}');
    });
    attachPhone('http://p:1/r');
    postSoon();
    postSoon();
    await tick(1);
    expect(count).toBe(1);
  });

  it('stops posting after detach', async () => {
    let count = 0;
    setLinkTransport(() => {
      count++;
      return Promise.resolve('{}');
    });
    attachPhone('http://p:1/r');
    detachPhone();
    await tick(2000);
    expect(count).toBe(0);
    expect(phoneAttached.value).toBe(false);
  });
});
