// The TV's client of the phone's search server (PhoneRpcService + mobile/rpc.html): POST <phone>/omp/<token>/rpc with
// {method, params}. The token is a credential: it is never logged or shown. Chromium 53: XHR with its own timeout.
import { signal } from '@preact/signals';
import { phoneLink } from './phoneStore';

export const RPC_TIMEOUT_MS = 5000;

export type RpcErrorCode = 'nophone' | 'unreachable' | 'timeout' | 'bad_request' | 'unknown_method' | 'not_ready' | 'expired' | 'failed';

const KNOWN: RpcErrorCode[] = ['nophone', 'unreachable', 'timeout', 'bad_request', 'unknown_method', 'not_ready', 'expired', 'failed'];

export class PhoneRpcError extends Error {
  code: RpcErrorCode;
  constructor(code: RpcErrorCode, message?: string) {
    super(message || '');
    this.code = code;
    this.name = 'PhoneRpcError';
    Object.setPrototypeOf(this, PhoneRpcError.prototype);
  }
}

export type PhoneStatus = 'unknown' | 'online' | 'offline';

/** online after any answer of the phone's page; offline after unreachable / timeout / not_ready. */
export const phoneStatus = signal<PhoneStatus>('unknown');

export type RpcTransport = (url: string, body: string, timeoutMs: number) => Promise<string>;

let transportOverride: RpcTransport | null = null;

function xhrTransport(url: string, body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Content-Type', 'text/plain');
    x.timeout = timeoutMs;
    x.onload = () => (x.status === 200 ? resolve(x.responseText) : reject(new Error('http ' + x.status)));
    x.onerror = () => reject(new Error('network'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.send(body);
  });
}

/** Test seam: replaces the XHR transport; null restores it. */
export function setRpcTransport(t: RpcTransport | null): void {
  transportOverride = t;
}

function setStatus(s: PhoneStatus): void {
  if (phoneStatus.value !== s) phoneStatus.value = s;
}

function down(code: RpcErrorCode): PhoneRpcError {
  setStatus('offline');
  return new PhoneRpcError(code);
}

export function phoneRpc<T>(method: string, params?: object): Promise<T> {
  const link = phoneLink.value;
  if (!link) return Promise.reject(new PhoneRpcError('nophone'));
  const url = link.url + '/omp/' + link.token + '/rpc';
  const body = JSON.stringify({ method: method, params: params || {} });
  const send = transportOverride || xhrTransport;
  let sent: Promise<string>;
  try {
    sent = Promise.resolve(send(url, body, RPC_TIMEOUT_MS));
  } catch (e) {
    sent = Promise.reject(e);
  }
  return sent.then(
    (text) => {
      let reply: unknown;
      try {
        reply = JSON.parse(text);
      } catch (e) {
        throw down('unreachable');
      }
      if (!reply || typeof reply !== 'object' || typeof (reply as { ok?: unknown }).ok !== 'boolean') throw down('unreachable');
      const r = reply as { ok: boolean; result?: unknown; error?: unknown };
      if (r.ok) {
        setStatus('online');
        return r.result as T;
      }
      const err = r.error && typeof r.error === 'object' ? (r.error as { code?: unknown; message?: unknown }) : {};
      const raw = typeof err.code === 'string' ? err.code : 'failed';
      const code: RpcErrorCode = KNOWN.indexOf(raw as RpcErrorCode) >= 0 && raw !== 'nophone' && raw !== 'unreachable' ? (raw as RpcErrorCode) : 'failed';
      // not_ready: the phone's hidden page is not up; timeout: it did not answer the phone's server in time
      if (code === 'not_ready' || code === 'timeout') throw down(code);
      setStatus('online');
      throw new PhoneRpcError(code, typeof err.message === 'string' ? err.message : '');
    },
    (e) => {
      if (e instanceof PhoneRpcError) throw e;
      const msg = e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : '';
      throw down(msg === 'timeout' ? 'timeout' : 'unreachable');
    },
  );
}
