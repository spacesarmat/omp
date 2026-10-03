// Test helpers for the tracker parsers: fixtures, a scripted SourceHttp and an in-memory SecretStore. No network.
import type { HttpOptions, HttpResponse, SecretStore, SourceContext } from '../../src/sources/types';

const FIXTURES = import.meta.glob('./fixtures/*.html', { query: '?raw', import: 'default', eager: true }) as { [path: string]: string };

/** Fixtures are stored decoded to UTF-8, as the native http returns them (windows-1251 sites included). */
export function fixture(name: string): string {
  const text = FIXTURES['./fixtures/' + name];
  if (typeof text !== 'string') throw new Error('no fixture ' + name);
  return text;
}

export interface HttpCall {
  method: 'GET' | 'POST';
  url: string;
  form?: { [key: string]: string };
  opts?: HttpOptions;
}

export type Responder = (call: HttpCall) => HttpResponse | Promise<HttpResponse>;

export function page(text: string, url: string, status?: number): HttpResponse {
  return { status: status === undefined ? 200 : status, url, text };
}

export interface FakeSite {
  ctx: SourceContext;
  calls: HttpCall[];
  cleared: string[];
  secrets: { [key: string]: string };
}

/** `secrets: null` = a context without the secret store (outside the Android app). */
export function fakeSite(respond: Responder, secrets?: { [key: string]: string } | null): FakeSite {
  const calls: HttpCall[] = [];
  const cleared: string[] = [];
  const stored: { [key: string]: string } = secrets ? { ...secrets } : {};
  const run = (call: HttpCall): Promise<HttpResponse> => {
    calls.push(call);
    try {
      return Promise.resolve(respond(call));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  const store: SecretStore = {
    get: (key) => Promise.resolve(Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null),
    set: (key, value) => {
      stored[key] = value;
      return Promise.resolve();
    },
    delete: (key) => {
      delete stored[key];
      return Promise.resolve();
    },
  };
  const ctx: SourceContext = {
    http: {
      get: (url, opts) => run({ method: 'GET', url, opts }),
      post: (url, form, opts) => run({ method: 'POST', url, form, opts }),
      clearCookies: (url) => {
        cleared.push(url);
        return Promise.resolve();
      },
    },
    client: null,
  };
  if (secrets !== null) ctx.secrets = store;
  return { ctx, calls, cleared, secrets: stored };
}

export const CLOUDFLARE =
  '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>';
