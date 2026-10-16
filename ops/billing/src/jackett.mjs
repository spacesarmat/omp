export const JACKETT_MARK = 'omp-fetch:';
export const JACRED_MARK = 'omp-jacred:';

/** Jackett or JacRed settings for a phone search (`source`) or a saved download link. */
export function indexerOf(settings, source) {
  const s = settings || {};
  if (source === 'jacred') {
    return { name: 'jacred', url: s.jacredUrl || '', key: s.jacredApiKey || '', mark: JACRED_MARK };
  }
  return { name: 'jackett', url: s.jackettUrl || '', key: s.jackettApiKey || '', mark: JACKETT_MARK };
}

export function indexerByLink(settings, link) {
  if (String(link || '').indexOf(JACRED_MARK) === 0) return indexerOf(settings, 'jacred');
  return indexerOf(settings, 'jackett');
}

/** Basic auth for an indexer that sits behind the panel proxy. Empty user means no header. */
export function basicAuthHeader(settings) {
  const user = String((settings || {}).indexerUser || '');
  if (!user) return '';
  const pass = String(settings.indexerPass || '');
  return 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
}

/** Removes the indexer key and replaces its origin so the phone never sees either. */
export function stripJackett(xml, origin, apiKey, mark) {
  let out = String(xml || '');
  const key = String(apiKey || '');
  if (key) out = out.split(key).join('');
  const base = String(origin || '').replace(/\/+$/, '');
  const prefix = mark || JACKETT_MARK;
  if (base) out = out.split(base).join(prefix);
  return out.replace(/([?&])(apikey|api_key|jackett_apikey)=[^&"'\s]*/gi, '$1');
}

/** `omp-fetch:/api/...` or `omp-jacred:/api/...` back into an indexer URL with the key attached. */
export function restoreJackett(link, origin, apiKey, mark) {
  const base = String(origin || '').replace(/\/+$/, '');
  const raw = String(link || '');
  const prefix = mark || JACKETT_MARK;
  if (raw.indexOf(prefix) !== 0 || !base) return '';
  let path = raw.slice(prefix.length);
  if (!path) return '';
  // no absolute / protocol-relative URLs, traversal, or backslashes - stay on the configured indexer origin
  if (path.indexOf('//') === 0 || /^https?:/i.test(path) || path.indexOf('://') >= 0 || path.indexOf('..') >= 0 || path.indexOf('\\') >= 0) {
    return '';
  }
  if (path.charAt(0) !== '/') path = '/' + path;
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/.test(path)) return '';
  let target;
  try {
    target = new URL(base + path);
  } catch {
    return '';
  }
  let originUrl;
  try {
    originUrl = new URL(base + '/');
  } catch {
    return '';
  }
  if (target.origin !== originUrl.origin) return '';
  // Search and the indexer admin API stay on /v1/search. A caller-chosen path must be a download.
  // jackettUrl may be https://host/jackett, so compare the path under that base, not the site root.
  const relative = pathWithinBase(target.pathname, originUrl.pathname);
  if (!relative || !isDownloadPath(relative)) return '';
  const key = encodeURIComponent(apiKey || '');
  return target.href + (target.search ? '&' : '?') + 'apikey=' + key;
}

/** `targetPath` with the configured base directory removed, or '' if it leaves that directory. */
function pathWithinBase(targetPath, basePath) {
  const base = String(basePath || '/').replace(/\/+$/, '');
  const full = String(targetPath || '/');
  if (!base) return full;
  if (full === base) return '/';
  if (full.indexOf(base + '/') !== 0) return '';
  return full.slice(base.length);
}

/** Jackett `/dl/…` and the per-indexer Torznab download route. `all` is the search API. */
function isDownloadPath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  if (path.indexOf('%') >= 0 || path.indexOf('\\') >= 0 || path.indexOf('..') >= 0) return false;
  if (path === '/dl' || path.indexOf('/dl/') === 0) return /^\/dl(?:\/[A-Za-z0-9._~-]+)*$/.test(path);
  const download = /^\/api\/v2\.0\/indexers\/([A-Za-z0-9._~-]+)\/results\/torznab\/download$/.exec(path);
  return !!(download && download[1] !== 'all');
}

export function jackettSearchUrl(origin, apiKey, query) {
  const base = String(origin || '').replace(/\/+$/, '');
  return (
    base +
    '/api/v2.0/indexers/all/results/torznab/api?apikey=' +
    encodeURIComponent(apiKey || '') +
    '&t=search&q=' +
    encodeURIComponent(query || '')
  );
}
