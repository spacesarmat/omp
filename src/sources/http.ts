// SourceHttp / SecretStore over the native plugin calls (OmpNative.http, secretGet/Set/Delete).
// The phone (mobile/src/platform/native.ts) and the Android TV bundle (src/platform/androidNative.ts) pass
// their own plugin calls; tests pass fakes.
import type { HttpOptions, HttpResponse, SecretStore, SourceHttp } from './types';
import { hostOf, logCloudflare, toCloudflareError } from './cloudflare';
import { flareSolverrUrl } from './flareStore';

/** Arguments of OmpNative.http. */
export interface NativeHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: { [name: string]: string };
  form?: { [key: string]: string };
  formCharset?: string;
  responseCharset?: string;
  body?: string;
  timeoutMs?: number;
  /** Pass a Cloudflare check on the way (the site's switch is on). */
  cloudflare?: boolean;
  /** The user's FlareSolverr, only with cloudflare. */
  flaresolverr?: string;
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

function withOptions(req: NativeHttpRequest, opts: HttpOptions | undefined, flare: () => string | null): NativeHttpRequest {
  if (!opts) return req;
  if (opts.headers) req.headers = opts.headers;
  if (opts.formCharset) req.formCharset = opts.formCharset;
  if (opts.responseCharset) req.responseCharset = opts.responseCharset;
  if (opts.timeoutMs) req.timeoutMs = opts.timeoutMs;
  if (opts.cloudflare) {
    req.cloudflare = true;
    const f = flare();
    if (f) req.flaresolverr = f;
  }
  return req;
}

function passed(r: unknown): boolean {
  const c = r && typeof r === 'object' ? (r as { cloudflare?: unknown }).cloudflare : undefined;
  return c === 'browser' || c === 'flaresolverr';
}

/**
 * flare: the FlareSolverr address sent with requests that pass Cloudflare checks (the saved one by default; tests pass
 * their own). A Cloudflare failure rejects with a CloudflareError (code + siteUrl); passes and failures are logged with
 * the site name only.
 */
export function createSourceHttp(
  call: NativeHttpCall,
  clearCookies?: (url: string) => Promise<unknown>,
  flare: () => string | null = flareSolverrUrl,
): SourceHttp {
  const send = (req: NativeHttpRequest, opts?: HttpOptions): Promise<HttpResponse> => {
    if (!isHttpUrl(req.url)) return Promise.reject(new Error(BAD_URL));
    const site = () => (opts && opts.siteName) || hostOf(req.url);
    return call(req).then(
      (r) => {
        if (req.cloudflare && passed(r)) logCloudflare('passed', site());
        return response(r, req.url);
      },
      (e: unknown) => {
        const cf = toCloudflareError(e, req.url);
        if (!cf) throw e;
        logCloudflare(cf.code, site());
        throw cf;
      },
    );
  };
  return {
    get: (url, opts) => send(withOptions({ url, method: 'GET' }, opts, flare), opts),
    post: (url, form, opts) => send(withOptions({ url, method: 'POST', form }, opts, flare), opts),
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
