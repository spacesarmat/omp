import { log } from '../lib/log';
import { t } from '../i18n';

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse';

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  status?: number;
}

// Plain Error + fields: subclassing Error breaks instanceof after ES5 transpilation.
export function apiError(kind: ApiErrorKind, message: string, status?: number): Error & ApiError {
  const e = new Error(message) as Error & ApiError;
  e.kind = kind;
  if (status !== undefined) e.status = status;
  return e;
}

export function isApiError(e: unknown): e is ApiError {
  return !!e && typeof (e as ApiError).kind === 'string';
}

export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    switch (e.kind) {
      case 'network': return t('errors.network');
      case 'timeout': return t('errors.timeout');
      case 'http': return t('errors.http', { status: String(e.status) });
      case 'parse': return t('errors.parse');
    }
  }
  if (e && typeof (e as Error).message === 'string') return (e as Error).message;
  return t('errors.unknown');
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  auth?: string;
  responseType?: 'json' | 'text' | 'arraybuffer';
  /** The caller expects this to fail sometimes (optional endpoints, offline checks): keep it out of the log. */
  quiet?: boolean;
  /** Extra request headers. Basic auth, when set, replaces an Authorization header from here. */
  headers?: { [k: string]: string };
  /** Sends the request instead of fetch() (Android: a TorrServer over https goes through the native trust). */
  transport?: HttpTransport;
}

/** What a transport gets: the body as text or as base64 bytes, its type apart from the headers. */
export interface TransportRequest {
  method: 'GET' | 'POST';
  headers: { [k: string]: string };
  body?: string;
  bodyBase64?: string;
  contentType?: string;
  timeoutMs: number;
}

/**
 * A request path other than the page's fetch(). Rejects with { code } (`timeout`, `tls-untrusted`, `tls-changed`,
 * `tls`, `network`, ...).
 */
export interface HttpTransport {
  send(url: string, req: TransportRequest): Promise<{ status: number; base64: string }>;
}

/** A transport failure as an ApiError: a timeout stays one, the rest is no answer; `tls` keeps the certificate code. */
export function transportError(e: unknown): Error & ApiError & { tls?: string } {
  const code = e && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : '';
  if (code === 'timeout') return apiError('timeout', 'Timeout');
  const err = apiError('network', 'Network error') as Error & ApiError & { tls?: string };
  if (code.indexOf('tls') === 0) err.tls = code;
  return err;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64 || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The bytes as base64 (chunked: a large upload must not overflow the argument list). */
export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + 0x8000) as number[]);
  return btoa(bin);
}

/** The part of a fetch() answer that request() reads. */
export interface FetchLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** [t] as fetch(): the answer's bytes decoded as UTF-8 for text(). */
export function transportFetch(t: HttpTransport, url: string, req: TransportRequest): Promise<FetchLike> {
  const headers: { [k: string]: string } = {};
  let contentType = req.contentType;
  const names = Object.keys(req.headers);
  for (let i = 0; i < names.length; i++) {
    if (names[i].toLowerCase() === 'content-type') contentType = req.headers[names[i]];
    else headers[names[i]] = req.headers[names[i]];
  }
  return t.send(url, { method: req.method, headers, body: req.body, bodyBase64: req.bodyBase64, contentType, timeoutMs: req.timeoutMs }).then(
    (r) => {
      const bytes = fromBase64(r.base64);
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        text: () => Promise.resolve(new TextDecoder('utf-8').decode(bytes)),
        arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
      };
    },
    (e) => {
      throw transportError(e);
    },
  );
}

/** Failed request -> log: kind, status and site kind only (scrub drops everything after the host). */
function logFailure(url: string, e: unknown): void {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^\/?#]*/i.exec(url);
  const k = isApiError(e) ? e.kind : 'unknown';
  const st = isApiError(e) && e.status !== undefined ? ' ' + e.status : '';
  log('error', 'server', t('log.requestFailed', { kind: k, status: st, host: m ? m[0] : t('log.address') }));
}

export function request<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const headers: { [k: string]: string } = {};
  const hasBody = opts.body !== undefined;
  if (opts.headers) {
    const names = Object.keys(opts.headers);
    for (let i = 0; i < names.length; i++) headers[names[i]] = opts.headers[names[i]];
  }
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (opts.auth) headers['Authorization'] = 'Basic ' + opts.auth;
  const type = opts.responseType || 'json';

  const method = opts.method || (hasBody ? 'POST' : 'GET');
  const body = hasBody ? JSON.stringify(opts.body) : undefined;
  const timeoutMs = opts.timeoutMs === undefined ? 5000 : opts.timeoutMs;
  const sent: Promise<FetchLike> = opts.transport
    ? transportFetch(opts.transport, url, { method, headers, body, timeoutMs: timeoutMs > 0 ? timeoutMs : 120000 })
    : fetch(url, { method, headers, body });
  const p = sent.then(
    (res) => {
      if (!res.ok) throw apiError('http', 'HTTP ' + res.status, res.status);
      if (type === 'arraybuffer') {
        return res.arrayBuffer().then((buf) => buf as unknown as T).catch((e) => {
          throw isApiError(e) ? e : apiError('network', 'Network error');
        });
      } else if (type === 'text') {
        return res.text().then((text) => text as unknown as T).catch((e) => {
          throw isApiError(e) ? e : apiError('network', 'Network error');
        });
      } else {
        return res.text().then((text) => {
          if (!text) return null as unknown as T;
          try {
            return JSON.parse(text) as T;
          } catch (e) {
            throw apiError('parse', 'Bad JSON');
          }
        }).catch((e) => {
          throw isApiError(e) ? e : apiError('network', 'Network error');
        });
      }
    },
    (e) => {
      // a transport already says what failed (a timeout, a refused certificate)
      throw isApiError(e) ? e : apiError('network', 'Network error');
    },
  );

  // a transport times out by itself (timeoutMs above): the page's timer would also cut off a certificate question
  const timeout = opts.transport ? 0 : timeoutMs;
  if (timeout <= 0) {
    // a side branch: the caller's promise gets no extra tick
    if (!opts.quiet) p.then(undefined, (e) => logFailure(url, e));
    return p;
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      const e = apiError('timeout', 'Timeout');
      if (!opts.quiet) logFailure(url, e);
      reject(e);
    }, timeout);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => {
        clearTimeout(timer);
        // after the timeout fired the failure is already logged and rejected
        if (settled) return;
        if (!opts.quiet) logFailure(url, e);
        reject(e);
      },
    );
  });
}
