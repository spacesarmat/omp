export type LaunchAction =
  | { kind: 'play'; url: string; title: string }
  | { kind: 'torrent'; hash: string; file?: number; t?: number }
  | { kind: 'magnet'; link: string };

export interface LaunchPlan {
  server?: string;
  action?: LaunchAction;
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
  if (!plan.server && !plan.action && !plan.invalid) return null;
  return plan;
}
