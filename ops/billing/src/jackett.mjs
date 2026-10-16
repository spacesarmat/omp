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
  const key = encodeURIComponent(apiKey || '');
  return target.href + (target.search ? '&' : '?') + 'apikey=' + key;
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
