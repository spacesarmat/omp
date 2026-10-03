// Search sources: TorrServer (rutor, Torznab) and built-in tracker parsers (Android only).
// Shared by the phone and the TV bundles: Chromium 53 rules (no Error subclasses, no AbortController).
import type { SearchResult } from '../api/types';
import type { SearchSource } from '../api/torrserver';

export interface HttpResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  /** Body decoded by its charset (windows-1251 and koi8-r included). */
  text: string;
}

export interface HttpOptions {
  headers?: { [name: string]: string };
  timeoutMs?: number;
  /** Charset of a POST form body, e.g. 'windows-1251' for old trackers. Default UTF-8. */
  formCharset?: string;
}

/** HTTP through the native Android plugin: no CORS, browser User-Agent, cookies per site. */
export interface SourceHttp {
  get(url: string, opts?: HttpOptions): Promise<HttpResponse>;
  post(url: string, form: { [key: string]: string }, opts?: HttpOptions): Promise<HttpResponse>;
  /** Forgets the cookies of the site of `url` (logout). */
  clearCookies(url: string): Promise<void>;
}

/** Android encrypted storage (Keystore) for tracker passwords and sessions. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SourceResult extends SearchResult {
  /** Source id. */
  source: string;
  /** Ids of the other sources with the same release (merged duplicates): «ещё в …». */
  sources?: string[];
  /** Page of the release (a magnet may be taken from it). */
  detailUrl?: string;
  /** Lowercase 40-hex infohash when known. */
  hash?: string;
  /** Unix ms. */
  date?: number;
  sizeBytes?: number;
}

export interface SourceContext {
  http: SourceHttp;
  /** TorrServer client for the TorrServer sources; null when no server is chosen. */
  client: { search(query: string, source: SearchSource): Promise<SearchResult[]> } | null;
  secrets?: SecretStore;
}

export interface Source {
  id: string;
  name: string;
  kind: 'torrserver' | 'builtin';
  needsLogin?: boolean;
  search(query: string, ctx: SourceContext): Promise<SourceResult[]>;
  /**
   * Link to add from the release page when the search result has no magnet: a magnet, or an http(s) .torrent
   * link (Anidub) that TorrServer downloads itself.
   */
  magnet?(detailUrl: string, ctx: SourceContext): Promise<string>;
  /** Sources with needsLogin: sign in; the credentials go to ctx.secrets only. Rejects in Russian. */
  login?(username: string, password: string, ctx: SourceContext): Promise<void>;
  /** Forgets the site cookies and the saved credentials. */
  logout?(ctx: SourceContext): Promise<void>;
  /** Saved credentials exist (no network). */
  loggedIn?(ctx: SourceContext): Promise<boolean>;
}

export type HealthState = 'ok' | 'error' | 'login';

export interface SourceHealth {
  state: HealthState;
  /** Answer time of the last successful search. */
  ms?: number;
  /** When it was recorded, unix ms. */
  at: number;
  /** Error text of a failed search (e.g. the Cloudflare block). */
  message?: string;
}

const LOGIN = 'login';

/** Error a source rejects with when it needs a login (health «нужен вход»). */
export function loginRequired(): Error {
  const e = new Error('Нужен вход');
  (e as Error & { code?: string }).code = LOGIN;
  return e;
}

export function isLoginRequired(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === LOGIN;
}
