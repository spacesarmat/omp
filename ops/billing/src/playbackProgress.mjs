// Body of GET/POST /v1/progress. Keys are titles the app already shows. No token, no device id in the error text.

const KEY_MAX = 80;
const EP_MAX = 48;
const POS_MAX = 200000;

function clean(v, max) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function pos(v) {
  const n = Math.floor(Number(v));
  if (!isFinite(n) || n < 0 || n > POS_MAX) return -1;
  return n;
}

/** GET query. `episodeKey` may be empty: the newest row of the title. */
export function parseProgressQuery(params) {
  const titleKey = clean(params.get('titleKey'), KEY_MAX);
  const episodeKey = clean(params.get('episodeKey'), EP_MAX);
  if (!titleKey) return { error: 'bad_query' };
  return { titleKey, episodeKey };
}

/** POST body, JSON or form fields. */
export function parseProgressBody(body) {
  const src = body && typeof body === 'object' ? body : {};
  const titleKey = clean(src.titleKey, KEY_MAX);
  const episodeKey = clean(src.episodeKey, EP_MAX);
  const positionSec = pos(src.positionSec);
  const durationSec = pos(src.durationSec === undefined || src.durationSec === '' ? 0 : src.durationSec);
  if (!titleKey || !episodeKey || positionSec < 1 || durationSec < 0) return { error: 'bad_body' };
  return {
    titleKey,
    episodeKey,
    positionSec,
    durationSec,
    title: clean(src.title, 180),
    label: clean(src.label, 80),
  };
}
