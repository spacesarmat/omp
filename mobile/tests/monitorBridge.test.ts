import { describe, it, expect } from 'vitest';
import { bridgeHost, windowHost, type HostPort } from '../src/monitor/host';
import { createMonitorNative, parseStatus, type MonitorPlugin } from '../src/monitor/native';

function port(answer: (msg: any) => unknown | undefined): HostPort & { sent: any[] } {
  const p: HostPort & { sent: any[] } = {
    sent: [],
    onmessage: null,
    postMessage(m: string) {
      const msg = JSON.parse(m);
      p.sent.push(msg);
      const reply = answer(msg);
      if (reply !== undefined) Promise.resolve().then(() => p.onmessage!({ data: JSON.stringify(reply) }));
    },
  };
  return p;
}

describe('monitor bridge (page side)', () => {
  it('matches answers to requests by id', async () => {
    const p = port((m) => {
      if (m.op === 'start') return { id: m.id, ok: true, value: { deadline: 123, action: { kind: 'add', subId: 's', key: 'k' } } };
      if (m.op === 'http') return { id: m.id, ok: true, value: { status: 200, url: m.request.url, text: 'ok' } };
      if (m.op === 'secretGet') return { id: m.id, ok: true, value: { value: 'u' } };
      if (m.op === 'notify') return { id: m.id, ok: false, error: 'Неверный запрос' };
      return undefined;
    });
    const h = bridgeHost(p);
    expect(await h.start()).toEqual({ deadline: 123, action: { kind: 'add', subId: 's', key: 'k' } });
    const [a, b] = await Promise.all([h.http({ url: 'https://a.b/1', method: 'GET' }), h.http({ url: 'https://a.b/2', method: 'GET' })]);
    expect(a.url).toBe('https://a.b/1');
    expect(b.url).toBe('https://a.b/2');
    expect(await h.secretGet('rutracker.user')).toEqual({ value: 'u' });
    await expect(h.notify({ channel: 'subs', id: 'x', subId: 's', key: 'k', title: 't', text: '' })).rejects.toThrow('Неверный запрос');
    h.finish({ at: 1, kind: 'check', found: 0, notified: 0, answered: 0, asked: 0, subs: 0, skipped: 0, feed: false });
    expect(p.sent[p.sent.length - 1].op).toBe('finish');
    expect(p.sent.map((m) => m.op)).toEqual(['start', 'http', 'http', 'secretGet', 'notify', 'finish']);
  });

  it('ignores a malformed action and garbage messages', async () => {
    const p = port((m) => ({ id: m.id, ok: true, value: { deadline: 5, action: { kind: 'delete', subId: 's', key: 'k' } } }));
    const h = bridgeHost(p);
    p.onmessage!({ data: 'not json' });
    p.onmessage!({ data: JSON.stringify({ id: 999, ok: true }) });
    expect(await h.start()).toEqual({ deadline: 5, action: null });
  });

  it('there is no host outside the monitor WebView', () => {
    expect(windowHost()).toBeNull();
  });
});

describe('monitor plugin wrapper', () => {
  it('outside Android: unavailable, no status, no links', async () => {
    const m = createMonitorNative(null);
    expect(m.available).toBe(false);
    await expect(m.schedule({ enabled: true, hours: 3, wifiOnly: true })).rejects.toThrow('Доступно только в приложении Android');
    await expect(m.runNow()).rejects.toThrow();
    expect(await m.status()).toBeNull();
    expect(await m.notifyPermission()).toBe('denied');
    expect(await m.takeOpen()).toBeNull();
    expect(() => m.onOpen(() => {})()).not.toThrow();
  });

  it('parses the status and only accepts omp:news links', async () => {
    const listeners: { [e: string]: (d: any) => void } = {};
    const plugin = {
      monitorSchedule: () => Promise.resolve(),
      monitorRunNow: () => Promise.resolve(),
      monitorStatus: () =>
        Promise.resolve({
          enabled: true,
          hours: 6,
          wifiOnly: false,
          running: false,
          lastRun: 1000,
          lastSummary: JSON.stringify({ at: 1000, kind: 'check', found: 2, answered: 3, asked: 4 }),
          nextRun: 2000,
        }),
      monitorNotifyPermission: () => Promise.resolve({ state: 'prompt' }),
      requestMonitorNotifyPermission: () => Promise.resolve({ state: 'granted' }),
      takeMonitorOpen: () => Promise.resolve({ url: 'omp:news?sub=s&finding=k' }),
      addListener: (e: string, cb: (d: any) => void) => {
        listeners[e] = cb;
        return Promise.resolve({ remove: () => Promise.resolve() });
      },
    } as unknown as MonitorPlugin;
    const m = createMonitorNative(plugin);
    const s = await m.status();
    expect(s).toMatchObject({ enabled: true, hours: 6, wifiOnly: false, running: false, lastRun: 1000, nextRun: 2000 });
    expect(s!.lastSummary).toMatchObject({ at: 1000, found: 2, answered: 3, asked: 4, kind: 'check' });
    expect(await m.notifyPermission()).toBe('prompt');
    expect(await m.requestNotifyPermission()).toBe('granted');
    expect(await m.takeOpen()).toBe('omp:news?sub=s&finding=k');
    const got: string[] = [];
    m.onOpen((u) => got.push(u));
    await Promise.resolve();
    listeners.monitorOpen({ url: 'https://evil.example/' });
    listeners.monitorOpen({ url: 'omp:news?sub=s&finding=k&watch=1' });
    expect(got).toEqual(['omp:news?sub=s&finding=k&watch=1']);
  });

  it('a status without a summary reports the error', () => {
    expect(parseStatus({ enabled: false, lastError: 'Проверка не уложилась в 3 минуты', lastSummary: '{bad' })).toEqual({
      enabled: false,
      hours: 3,
      wifiOnly: true,
      running: false,
      lastError: 'Проверка не уложилась в 3 минуты',
    });
  });
});
