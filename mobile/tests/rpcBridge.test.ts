import { describe, it, expect } from 'vitest';
import { createRpcBridge, windowRpcPort, type HostPort } from '../src/rpc/host';
import { RpcError } from '../src/rpc/handler';

function port(answer: (msg: any) => unknown | undefined = () => undefined): HostPort & { sent: any[] } {
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

const flush = () => new Promise((r) => setTimeout(r, 0));
const call = (p: HostPort, msg: object) => p.onmessage!({ data: JSON.stringify(msg) });

describe('rpc bridge (page side)', () => {
  it('says ready first', () => {
    const p = port();
    createRpcBridge(p);
    expect(p.sent).toEqual([{ op: 'ready' }]);
  });

  it('answers a call with rpcReply', async () => {
    const p = port();
    createRpcBridge(p).serve(() => Promise.resolve({ a: 1 }));
    call(p, { rpc: 4, method: 'x', params: {} });
    await flush();
    expect(p.sent[1]).toEqual({ op: 'rpcReply', rpc: 4, ok: true, result: { a: 1 } });
  });

  it('passes the RpcError code, and failed for any other error', async () => {
    const p = port();
    createRpcBridge(p).serve((m) => Promise.reject(m === 'a' ? new RpcError('expired') : new Error('boom')));
    call(p, { rpc: 1, method: 'a', params: {} });
    call(p, { rpc: 2, method: 'b', params: {} });
    await flush();
    expect(p.sent[1]).toEqual({ op: 'rpcReply', rpc: 1, ok: false, error: { code: 'expired' } });
    expect(p.sent[2]).toEqual({ op: 'rpcReply', rpc: 2, ok: false, error: { code: 'failed', message: 'boom' } });
  });

  it('a call before serve gets not_ready', async () => {
    const p = port();
    createRpcBridge(p);
    call(p, { rpc: 7, method: 'sources', params: {} });
    await flush();
    expect(p.sent[1]).toEqual({ op: 'rpcReply', rpc: 7, ok: false, error: { code: 'not_ready' } });
  });

  it('matches http and secretGet answers by id', async () => {
    const p = port((m) => {
      if (m.op === 'http') return { id: m.id, ok: true, value: { status: 200, url: m.request.url, text: 'ok' } };
      if (m.op === 'secretGet') return m.key === 'bad' ? { id: m.id, ok: false, error: 'nope' } : { id: m.id, ok: true, value: { value: 'u' } };
      return undefined;
    });
    const b = createRpcBridge(p);
    const [x, y] = await Promise.all([b.http({ url: 'https://a.b/1', method: 'GET' }), b.http({ url: 'https://a.b/2', method: 'GET' })]);
    expect(x.url).toBe('https://a.b/1');
    expect(y.url).toBe('https://a.b/2');
    expect(await b.secretGet('rutracker.user')).toEqual({ value: 'u' });
    await expect(b.secretGet('bad')).rejects.toThrow('nope');
    p.onmessage!({ data: 'not json' });
    p.onmessage!({ data: JSON.stringify({ id: 999, ok: true }) });
    expect(p.sent.map((m) => m.op)).toEqual(['ready', 'http', 'http', 'secretGet', 'secretGet']);
  });

  it('a too large result is answered as failed', async () => {
    const p = port();
    createRpcBridge(p).serve(() => Promise.resolve({ big: 'x'.repeat(1_000_001) }));
    call(p, { rpc: 3, method: 'x', params: {} });
    await flush();
    expect(p.sent[1]).toMatchObject({ rpc: 3, ok: false, error: { code: 'failed' } });
  });

  it('there is no port outside the RPC WebView', () => {
    expect(windowRpcPort()).toBeNull();
  });
});
