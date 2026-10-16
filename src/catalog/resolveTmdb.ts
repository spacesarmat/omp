// Which TMDB key «Обзор» and the poster lookup use. Order: the active server's key, then the phone's own TorrServer
// (when it is running and it is a different server), then OMP's built-in key. An active server that does not answer
// is not the same as a server that answered and has no key.
import type { TmdbConfig } from '../api/types';
import { localTmdbSource, type TmdbSource } from './localTmdb';

export type TmdbKeySource = 'active' | 'local' | 'builtin';

export type TmdbResolution =
  | { status: 'ok'; config: TmdbConfig; source: TmdbKeySource }
  | { status: 'nokey' }
  | { status: 'unreachable' };

function ownKey(cfg: TmdbConfig | null | undefined): string {
  const k = cfg && typeof cfg.APIKey === 'string' ? cfg.APIKey.trim() : '';
  return k;
}

function withKey(cfg: TmdbConfig, key: string): TmdbConfig {
  if (cfg.APIKey === key) return cfg;
  return { APIKey: key, APIURL: cfg.APIURL, ImageURL: cfg.ImageURL, ImageURLRu: cfg.ImageURLRu };
}

/**
 * Resolves the key. `local` defaults to the registered phone server; pass null to skip it (tests). A local server
 * with the same address as the active one is not asked twice.
 */
export function resolveTmdbKey(opts: {
  active: TmdbSource | null;
  local?: TmdbSource | null;
  fallbackKey: string;
}): Promise<TmdbResolution> {
  const active = opts.active;
  const registered = opts.local === undefined ? localTmdbSource() : opts.local;
  const local = registered && (!active || registered.baseUrl !== active.baseUrl) ? registered : null;
  const fallback = (opts.fallbackKey || '').trim();

  const ask = (src: TmdbSource | null): Promise<{ key: string; config: TmdbConfig; down: boolean }> => {
    if (!src) return Promise.resolve({ key: '', config: {}, down: false });
    return src.readTmdbSettings().then(
      (r) => {
        if (r.status === 'unreachable') return { key: '', config: {}, down: true };
        const key = ownKey(r.config);
        return { key: key, config: r.config || {}, down: false };
      },
      () => ({ key: '', config: {}, down: true }),
    );
  };

  return ask(active).then((first) => {
    if (first.key) return { status: 'ok' as const, config: withKey(first.config, first.key), source: 'active' as const };
    return ask(local).then((second) => {
      if (second.key) return { status: 'ok' as const, config: withKey(second.config, second.key), source: 'local' as const };
      if (fallback) return { status: 'ok' as const, config: { APIKey: fallback }, source: 'builtin' as const };
      if (first.down) return { status: 'unreachable' as const };
      return { status: 'nokey' as const };
    });
  });
}
