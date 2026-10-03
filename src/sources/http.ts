// SourceHttp / SecretStore over the native plugin calls (OmpNative.http, secretGet/Set/Delete).
// The phone (mobile/src/platform/native.ts) and the Android TV bundle (src/platform/androidNative.ts) pass
// their own plugin calls; tests pass fakes.
import type { HttpOptions, HttpResponse, SecretStore, SourceHttp } from './types';

/** Arguments of OmpNative.http. */
export interface NativeHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: { [name: string]: string };
  form?: { [key: string]: string };
  formCharset?: string;
  body?: string;
  timeoutMs?: number;
}

export type NativeHttpCall = (req: NativeHttpRequest) => Promise<unknown>;

export const BAD_URL = 'Неверный адрес';

function isHttpUrl(url: string): boolean {
  return /^https?:\/\/[^\s/?#]+/i.test(url);
}

function response(r: unknown, url: string): HttpResponse {
  const o = r && typeof r === 'object' ? (r as { status?: unknown; url?: unknown; text?: unknown }) : {};
  return {
    status: typeof o.status === 'number' ? o.status : 0,
    url: typeof o.url === 'string' && o.url ? o.url : url,
    text: typeof o.text === 'string' ? o.text : '',
  };
}

function withOptions(req: NativeHttpRequest, opts?: HttpOptions): NativeHttpRequest {
  if (!opts) return req;
  if (opts.headers) req.headers = opts.headers;
  if (opts.formCharset) req.formCharset = opts.formCharset;
  if (opts.timeoutMs) req.timeoutMs = opts.timeoutMs;
  return req;
}

export function createSourceHttp(call: NativeHttpCall, clearCookies?: (url: string) => Promise<unknown>): SourceHttp {
  const send = (req: NativeHttpRequest): Promise<HttpResponse> => {
    if (!isHttpUrl(req.url)) return Promise.reject(new Error(BAD_URL));
    return call(req).then((r) => response(r, req.url));
  };
  return {
    get: (url, opts) => send(withOptions({ url, method: 'GET' }, opts)),
    post: (url, form, opts) => send(withOptions({ url, method: 'POST', form }, opts)),
    clearCookies(url) {
      if (!clearCookies) return Promise.resolve();
      return clearCookies(url).then(() => undefined);
    },
  };
}

export interface NativeSecretCalls {
  get(key: string): Promise<{ value?: string | null } | null | undefined>;
  set(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

export function createSecretStore(calls: NativeSecretCalls): SecretStore {
  return {
    get: (key) => calls.get(key).then((r) => (r && typeof r.value === 'string' ? r.value : null)),
    set: (key, value) => calls.set(key, value).then(() => undefined),
    delete: (key) => calls.delete(key).then(() => undefined),
  };
}
