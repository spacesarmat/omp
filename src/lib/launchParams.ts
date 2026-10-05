export type LaunchAction =
  | { kind: 'play'; url: string; title: string }
  | { kind: 'torrent'; hash: string; file?: number; t?: number; from?: string }
  | { kind: 'magnet'; link: string };

export interface LaunchPlan {
  server?: string;
  action?: LaunchAction;
  report?: string;
  /** a screen to open: `update` (sent by the phone when the TV has an old OMP) */
  open?: 'update';
  /** The phone's resolved UI language: the TV stores it as its own language setting. */
  lang?: 'ru' | 'en';
  invalid: boolean;
}

const HASH = /^[0-9a-f]{40}$/i;

function titleFromUrl(url: string): string {
  const last = url.split('?')[0].split('#')[0].split('/').pop() || '';
  try {
    return decodeURIComponent(last) || url;
  } catch (e) {
    return last || url;
  }
}

/** Launch params from webOS (JSON string) or an object; null when there is nothing for OMP. */
export function parseLaunchParams(raw: unknown): LaunchPlan | null {
  let p: unknown = raw;
  if (typeof p === 'string') {
    if (!p) return null;
    try {
      p = JSON.parse(p);
    } catch (e) {
      return null;
    }
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  const plan: LaunchPlan = { invalid: false };
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k);

  if (has('server')) {
    if (typeof o.server === 'string' && o.server.trim()) plan.server = o.server.trim();
    else plan.invalid = true;
  }
  if (has('report')) {
    const r = typeof o.report === 'string' ? o.report.trim() : '';
    if (/^http:\/\//i.test(r) && r.length <= 200) plan.report = r;
    else plan.invalid = true;
  }
  if (has('magnet')) {
    if (typeof o.magnet === 'string' && /^magnet:/i.test(o.magnet.trim())) plan.action = { kind: 'magnet', link: o.magnet.trim() };
    else plan.invalid = true;
  } else if (has('torrent')) {
    if (typeof o.torrent === 'string' && HASH.test(o.torrent.trim())) {
      const action: LaunchAction = { kind: 'torrent', hash: o.torrent.trim().toLowerCase() };
      const num = (v: unknown): number | null => {
        const n = typeof v === 'number' ? v : typeof v === 'string' && /^[0-9]+$/.test(v) ? +v : NaN;
        return isFinite(n) && n >= 0 && Math.floor(n) === n ? n : null;
      };
      if (has('file')) {
        const f = num(o.file);
        if (f === null) plan.invalid = true;
        else action.file = f;
      }
      // the phone that launched it (watch journal); optional, a bad value is just ignored
      if (action.file !== undefined && typeof o.from === 'string') {
        const from = o.from.replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 60);
        if (from) action.from = from;
      }
      if (has('t')) {
        const t = num(o.t);
        if (t === null || action.file === undefined) plan.invalid = true;
        else action.t = t;
      }
      plan.action = action;
    } else plan.invalid = true;
  } else if (has('play')) {
    if (typeof o.play === 'string' && /^https?:\/\//i.test(o.play.trim())) {
      const url = o.play.trim();
      const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : titleFromUrl(url);
      plan.action = { kind: 'play', url, title };
    } else plan.invalid = true;
  }
  // unknown screens are ignored, so a newer phone does not break an older TV
  if (o.open === 'update') plan.open = 'update';
  // an unknown language is ignored the same way
  if (o.lang === 'ru' || o.lang === 'en') plan.lang = o.lang;
  if (!plan.server && !plan.action && !plan.report && !plan.open && !plan.lang && !plan.invalid) return null;
  return plan;
}
