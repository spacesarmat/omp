/** Removes the Jackett key and replaces its origin so the phone never sees either. */
export function stripJackett(xml, origin, apiKey) {
  let out = String(xml || '');
  const key = String(apiKey || '');
  if (key) out = out.split(key).join('');
  const base = String(origin || '').replace(/\/+$/, '');
  if (base) out = out.split(base).join('omp-fetch:');
  return out.replace(/([?&])(apikey|api_key|jackett_apikey)=[^&"'\s]*/gi, '$1');
}

/** `omp-fetch:/api/...` back into a Jackett URL with the key attached. */
export function restoreJackett(link, origin, apiKey) {
  const base = String(origin || '').replace(/\/+$/, '');
  const raw = String(link || '');
  if (raw.indexOf('omp-fetch:') !== 0 || !base) return '';
  const path = raw.slice('omp-fetch:'.length);
  if (path.indexOf('//') === 0 || path.indexOf('http') === 0) return '';
  const join = path.charAt(0) === '/' ? base + path : base + '/' + path;
  const key = encodeURIComponent(apiKey || '');
  return join + (join.indexOf('?') >= 0 ? '&' : '?') + 'apikey=' + key;
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
