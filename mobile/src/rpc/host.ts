// The RPC page's link to Android (android/.../rpc/RpcPageHost.kt, RpcProtocol.kt). Android adds the object `OmpRpcHost`
// (androidx.webkit addWebMessageListener, only for this app's origin) to the hidden WebView.
// Page -> Android: {op:'ready'} once; {id, op:'http', request} / {id, op:'secretGet', key} answered {id, ok, value | error};
// {op:'rpcReply', rpc, ok, result | error:{code, message?}} answering a call.
// Android -> page: {rpc, method, params} (a TV call) and the {id, ...} answers above.
import { t } from '../../../src/i18n';
import type { NativeHttpRequest } from '../../../src/sources/http';
import type { HostPort, HttpReply } from '../monitor/host';
import { RpcError } from './handler';

export type { HostPort, HttpReply };

export const RPC_HOST_NAME = 'OmpRpcHost';
/** RpcProtocol.MAX_MESSAGE: Android drops a longer message. */
export const MAX_MESSAGE = 1_000_000;

export type RpcDispatch = (method: string, params: unknown) => Promise<unknown>;

export interface RpcBridge {
  http(req: NativeHttpRequest): Promise<HttpReply>;
  secretGet(key: string): Promise<{ value?: string | null }>;
  /** Starts answering the TV's calls with `dispatch`; calls that come before get `not_ready`. */
  serve(dispatch: RpcDispatch): void;
}

const failed = (): string => t('notify.noReply');

export function createRpcBridge(port: HostPort): RpcBridge {
  let next = 1;
  let dispatch: RpcDispatch | null = null;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  const post = (o: object): boolean => {
    try {
      port.postMessage(JSON.stringify(o));
      return true;
    } catch {
      return false;
    }
  };

  const reply = (rpc: number, ok: boolean, body: { result?: unknown; code?: string; message?: string }) => {
    if (ok) {
      let text: string;
      try {
        text = JSON.stringify({ op: 'rpcReply', rpc, ok: true, result: body.result === undefined ? null : body.result });
      } catch {
        return reply(rpc, false, { code: 'failed', message: 'unserializable' });
      }
      if (text.length > MAX_MESSAGE) return reply(rpc, false, { code: 'failed', message: 'too large' });
      try {
        port.postMessage(text);
      } catch {
        /* Android times the call out */
      }
      return;
    }
    const error: { code: string; message?: string } = { code: body.code || 'failed' };
    if (body.message) error.message = body.message;
    post({ op: 'rpcReply', rpc, ok: false, error });
  };

  const call = (rpc: number, method: string, params: unknown) => {
    if (!dispatch) {
      reply(rpc, false, { code: 'not_ready' });
      return;
    }
    let run: Promise<unknown>;
    try {
      run = Promise.resolve(dispatch(method, params));
    } catch (e) {
      run = Promise.reject(e);
    }
    run.then(
      (result) => reply(rpc, true, { result }),
      (e: unknown) => {
        if (e instanceof RpcError) reply(rpc, false, { code: e.code, message: e.message });
        else reply(rpc, false, { code: 'failed', message: e instanceof Error ? e.message : String(e) });
      },
    );
  };

  port.onmessage = (event) => {
    let m: { id?: unknown; ok?: unknown; value?: unknown; error?: unknown; rpc?: unknown; method?: unknown; params?: unknown } | null;
    try {
      m = typeof event.data === 'string' ? JSON.parse(event.data) : null;
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (typeof m.rpc === 'number' && typeof m.method === 'string') {
      call(m.rpc, m.method, m.params);
      return;
    }
    if (typeof m.id !== 'number') return;
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok === true) w.resolve(m.value);
    else w.reject(new Error(typeof m.error === 'string' && m.error ? m.error : failed()));
  };

  const send = (op: string, body: object): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      if (!post({ ...body, id, op })) {
        waiting.delete(id);
        reject(new Error(failed()));
      }
    });

  // the page listens from now on: Android keeps this message's reply channel for its calls
  post({ op: 'ready' });

  return {
    http: (req) => send('http', { request: req }).then((v) => (v && typeof v === 'object' ? (v as HttpReply) : {})),
    secretGet: (key) =>
      send('secretGet', { key }).then((v) => {
        const o = (v && typeof v === 'object' ? v : {}) as { value?: unknown };
        return { value: typeof o.value === 'string' ? o.value : null };
      }),
    serve(d) {
      dispatch = d;
    },
  };
}

/** The injected port, or null when the page is opened anywhere else. */
export function windowRpcPort(): HostPort | null {
  const port = (window as unknown as { [RPC_HOST_NAME]?: HostPort })[RPC_HOST_NAME];
  return port && typeof port.postMessage === 'function' ? port : null;
}
