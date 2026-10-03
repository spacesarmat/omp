import { request, HttpOptions } from './http';
import type { Torrent, CacheState, ViewedEntry, SearchResult, FfprobeResult, ServerSettings, TmdbConfig } from './types';
import type { TorrentFile } from '../lib/episodes';

export interface ServerConfig {
  url: string;
  user?: string;
  password?: string;
}

export type SearchSource = 'rutor' | 'torznab';

export function normalizeServerUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) {
    u = 'http://' + u;
    if (!/:\d+$/.test(u)) u += ':8090';
  }
  return u;
}

export function parseTorrentData(data?: string): TorrentFile[] {
  if (!data) return [];
  try {
    const d = JSON.parse(data);
    return (d && d.TorrServer && d.TorrServer.Files) || [];
  } catch (e) {
    return [];
  }
}

export class TorrServerClient {
  readonly baseUrl: string;
  private readonly auth?: string;
  private readonly cfg: ServerConfig;

  constructor(cfg: ServerConfig) {
    this.cfg = cfg;
    this.baseUrl = normalizeServerUrl(cfg.url);
    this.auth = cfg.user ? btoa(unescape(encodeURIComponent(cfg.user + ':' + (cfg.password || '')))) : undefined;
  }

  private call<T>(path: string, opts: HttpOptions = {}): Promise<T> {
    return request<T>(this.baseUrl + path, { ...opts, auth: this.auth });
  }

  private isOwnUrl(url: string): boolean {
    return url === this.baseUrl || url.indexOf(this.baseUrl + '/') === 0 || url.indexOf(this.baseUrl + '?') === 0;
  }

  private ownAuth(url: string): string | undefined {
    return this.isOwnUrl(url) ? this.auth : undefined;
  }

  echo(): Promise<string> {
    return this.call<string>('/echo', { responseType: 'text' }).then((s) => (s || '').trim());
  }

  list(): Promise<Torrent[]> {
    return this.call<Torrent[] | null>('/torrents', { body: { action: 'list' } }).then((r) => r || []);
  }

  get(hash: string): Promise<Torrent> {
    return this.call<Torrent>('/torrents', { body: { action: 'get', hash } });
  }

  add(p: { link: string; title?: string; poster?: string; category?: string }): Promise<Torrent> {
    return this.call<Torrent>('/torrents', {
      body: { action: 'add', link: p.link, title: p.title || '', poster: p.poster || '', category: p.category || '', save_to_db: true },
      timeoutMs: 30000,
    });
  }

  /** Replaces `data`; `set` overwrites title/poster/category too, so the current ones are sent back. */
  setData(t: Pick<Torrent, 'hash' | 'title' | 'poster' | 'category'> & { name?: string }, data: string): Promise<void> {
    const title = t.title || t.name || '';
    // an empty title makes TorrServer fetch the metadata itself: nothing to write then
    if (!title) return Promise.resolve();
    return this.call<unknown>('/torrents', {
      body: { action: 'set', hash: t.hash, title, poster: t.poster || '', category: t.category || '', data },
    }).then(() => undefined);
  }

  /** Sets the poster; an empty `data` keeps the stored one and an empty title is filled by TorrServer. */
  setPoster(t: Pick<Torrent, 'hash' | 'title' | 'category'> & { name?: string }, poster: string): Promise<void> {
    return this.call<unknown>('/torrents', {
      body: { action: 'set', hash: t.hash, title: t.title || t.name || '', poster, category: t.category || '', data: '' },
    }).then(() => undefined);
  }

  /** TMDB settings of the server; null on servers without them. */
  tmdbSettings(): Promise<TmdbConfig | null> {
    return this.call<TmdbConfig | null>('/tmdb/settings', { method: 'GET', quiet: true }).then(
      (r) => (r && typeof r === 'object' ? r : null),
      () => null,
    );
  }

  remove(hash: string): Promise<void> {
    return this.call<unknown>('/torrents', { body: { action: 'rem', hash } }).then(() => undefined);
  }

  /** Activates the torrent and waits for metadata (file list). */
  loadInfo(hash: string): Promise<Torrent> {
    return this.call<Torrent>('/stream?link=' + hash + '&stat', { timeoutMs: 60000 });
  }

  files(t: Torrent): TorrentFile[] {
    return t.file_stats && t.file_stats.length ? t.file_stats : parseTorrentData(t.data);
  }

  streamUrl(hash: string, fileIndex: number, name = 'file'): string {
    return this.baseUrl + '/stream/' + encodeURIComponent(name) + '?link=' + hash + '&index=' + fileIndex + '&play';
  }

  /** URL for <video>: media elements can't send headers, so credentials go into the URL. */
  videoSrc(url: string): string {
    if (!this.cfg.user || !this.isOwnUrl(url)) return url;
    const cred = encodeURIComponent(this.cfg.user) + ':' + encodeURIComponent(this.cfg.password || '') + '@';
    return url.replace(/^(https?:\/\/)/i, '$1' + cred);
  }

  playlistUrl(hash: string): string {
    return this.baseUrl + '/playlist?hash=' + hash;
  }

  allPlaylistUrl(): string {
    return this.baseUrl + '/playlistall/all.m3u';
  }

  fetchText(url: string, timeoutMs = 15000): Promise<string> {
    return request<string>(url, { responseType: 'text', timeoutMs, auth: this.ownAuth(url) });
  }

  fetchBytes(url: string, timeoutMs = 30000): Promise<ArrayBuffer> {
    return request<ArrayBuffer>(url, { responseType: 'arraybuffer', timeoutMs, auth: this.ownAuth(url) });
  }

  ffprobeAvailable(): Promise<boolean> {
    return this.call<{ available: boolean } | null>('/ffp/status', { quiet: true }).then((r) => !!(r && r.available), () => false);
  }

  probe(hash: string, fileIndex: number): Promise<FfprobeResult | null> {
    return this.call<FfprobeResult | null>('/ffp/' + hash + '/' + fileIndex, { timeoutMs: 30000, quiet: true }).then(
      (r) => (r && r.streams ? r : null),
      () => null,
    );
  }

  cache(hash: string): Promise<CacheState> {
    return this.call<CacheState>('/cache', { body: { action: 'get', hash } });
  }

  viewedList(): Promise<ViewedEntry[]> {
    return this.call<ViewedEntry[] | null>('/viewed', { body: { action: 'list' } }).then((r) => r || []);
  }

  setViewed(hash: string, fileIndex: number, timecode = 0): Promise<void> {
    return this.call<unknown>('/viewed', { body: { action: 'set', hash, file_index: fileIndex, timecode } }).then(() => undefined);
  }

  removeViewed(hash: string, fileIndex?: number): Promise<void> {
    const body = fileIndex === undefined ? { action: 'rem', hash } : { action: 'rem', hash, file_index: fileIndex };
    return this.call<unknown>('/viewed', { body }).then(() => undefined);
  }

  search(query: string, source: SearchSource): Promise<SearchResult[]> {
    const path = source === 'torznab' ? '/torznab/search/' : '/search/';
    return this.call<SearchResult[] | null>(path + '?query=' + encodeURIComponent(query), { timeoutMs: 45000 }).then((r) => r || []);
  }

  getSettings(): Promise<ServerSettings> {
    return this.call<ServerSettings>('/settings', { body: { action: 'get' } });
  }

  setSettings(sets: ServerSettings): Promise<void> {
    return this.call<unknown>('/settings', { body: { action: 'set', sets } }).then(() => undefined);
  }

  resetSettings(): Promise<void> {
    return this.call<unknown>('/settings', { body: { action: 'def' } }).then(() => undefined);
  }
}
