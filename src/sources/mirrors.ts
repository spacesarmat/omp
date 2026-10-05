// Mirrors of a site (Kinozal: kinozal.me, kinozal.guru, kinozal.tv): every request is built on the active mirror; a
// network failure (DNS block, refused connection, timeout, Cloudflare 52x origin errors) moves on to the next mirror and
// the one that answered is remembered per device (tsp.sourceMirrors, not a secret, not backed up). A redirect to
// another mirror makes it the active one. A Cloudflare check or an HTTP 4xx never switches: that is the check's or the
// site's answer. Single-host sites use the same object with one host. Chromium 53 safe.
import { isObject, loadJson, saveJson } from '../store/storage';
import { cloudflareFailure } from './cloudflare';
import type { HttpOptions, HttpResponse, SourceContext } from './types';

const KEY = 'tsp.sourceMirrors';
const HOST = /^[a-z0-9.-]+$/;

function saved(): { [id: string]: string } {
  const v = loadJson<unknown>(KEY, {}, isObject);
  const out: { [id: string]: string } = {};
  if (isObject(v)) Object.keys(v).forEach((id) => {
    const h = v[id];
    if (typeof h === 'string' && HOST.test(h) && h.length <= 100) out[id] = h;
  });
  return out;
}

/** Hostname of an http(s) address, '' otherwise. */
export function urlHost(url: string): string {
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i.exec(url || '');
  return m ? m[1].toLowerCase() : '';
}

/** Statuses of Cloudflare's own «origin unreachable» pages: the mirror is down, try the next one. */
function originDown(status: number): boolean {
  return (status >= 520 && status <= 527) || status === 530;
}

export interface SiteHosts {
  id: string;
  /** All mirrors, preferred order. */
  hosts: string[];
  /** The active mirror. */
  host(): string;
  /** https://<active>/ */
  base(): string;
  /** https://<mirror>/ of every mirror. */
  roots(): string[];
  /** `url` is on one of the mirrors (or a subdomain of one, e.g. dl.kinozal.tv). */
  onSite(url: string): boolean;
  /** Path and query of an address on one of the mirrors ('details.php?id=1'), null for any other address. */
  path(url: string): string | null;
  /** `url` is on another mirror than the active one: it becomes active. */
  adopt(url: string): void;
  /** GET of a path on the active mirror, the next mirrors on a network failure. */
  get(ctx: SourceContext, path: string, opts?: HttpOptions): Promise<HttpResponse>;
  /**
   * POST of a form. When the answer comes from another mirror (a redirect), that mirror becomes active and the POST is
   * sent again there once: a redirected POST arrives as a GET and its answer says nothing about the form.
   */
  post(ctx: SourceContext, path: string, form: { [key: string]: string }, opts?: HttpOptions): Promise<HttpResponse>;
}

/** Forgets the remembered mirrors (tests). */
export function resetMirrors(): void {
  saveJson(KEY, {});
}

export function createSiteHosts(id: string, hosts: string[]): SiteHosts {
  const list = hosts.map((h) => h.toLowerCase());
  const mirrorOf = (url: string): string => {
    const h = urlHost(url);
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (h === m || h.slice(-(m.length + 1)) === '.' + m) return m;
    }
    return '';
  };
  const host = () => {
    const h = saved()[id];
    return h && list.indexOf(h) >= 0 ? h : list[0];
  };
  const setHost = (h: string) => {
    if (h === host()) return;
    const all = saved();
    all[id] = h;
    saveJson(KEY, all);
  };
  const order = () => {
    const a = host();
    return [a].concat(list.filter((h) => h !== a));
  };
  const root = (h: string) => 'https://' + h + '/';

  /** Tries each mirror in turn; `run` sends one request to a mirror. */
  const tryAll = (run: (h: string) => Promise<HttpResponse>): Promise<HttpResponse> => {
    const hs = order();
    const next = (i: number, first: unknown): Promise<HttpResponse> =>
      run(hs[i]).then(
        (res) => {
          if (originDown(res.status) && i + 1 < hs.length) return next(i + 1, first);
          const moved = mirrorOf(res.url);
          setHost(moved || hs[i]);
          return res;
        },
        (e: unknown) => {
          // a Cloudflare check is the site's answer, not a dead mirror
          if (cloudflareFailure(e) || i + 1 >= hs.length) throw first === undefined ? e : first;
          return next(i + 1, first === undefined ? e : first);
        },
      );
    return next(0, undefined);
  };

  return {
    id,
    hosts: list.slice(),
    host,
    base: () => root(host()),
    roots: () => list.map(root),
    onSite: (url) => !!mirrorOf(url),
    path(url) {
      if (!mirrorOf(url)) return null;
      const m = /^https?:\/\/[^/?#]+\/?([^#]*)/i.exec(url);
      return m ? m[1] : '';
    },
    adopt(url) {
      const m = mirrorOf(url);
      if (m) setHost(m);
    },
    get(ctx, path, opts) {
      return tryAll((h) => (opts ? ctx.http.get(root(h) + path, opts) : ctx.http.get(root(h) + path)));
    },
    post(ctx, path, form, opts) {
      let sent = '';
      const send = (h: string) => {
        sent = h;
        return ctx.http.post(root(h) + path, form, opts);
      };
      return tryAll(send).then((res) => {
        const moved = mirrorOf(res.url);
        // the answer is on another mirror than the one that got the form (now the active one): send it again there
        if (!moved || moved === sent) return res;
        return ctx.http.post(root(moved) + path, form, opts).then((again) => {
          const m = mirrorOf(again.url);
          if (m) setHost(m);
          return again;
        });
      });
    },
  };
}
