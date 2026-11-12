// The best release a «Только лучшее качество» check saw, including one below the notification floor.
// It is not a finding, so it does not notify.
import { loadJson, saveJson } from '../store/storage';
import type { SourceResult } from '../sources/types';
import { loadSubs } from './subs';

const KEY = 'tsp.subBest';

function slim(r: SourceResult): SourceResult {
  const out: SourceResult = {
    Title: r.Title || '',
    Magnet: r.Magnet || '',
    Hash: r.Hash || '',
    Seed: r.Seed || 0,
    Peer: r.Peer || 0,
    Size: r.Size || '',
    source: r.source || '',
    Link: r.Link || '',
    Categories: r.Categories || '',
    Tracker: r.Tracker || '',
    CreateDate: r.CreateDate || '',
  };
  if (r.detailUrl) out.detailUrl = r.detailUrl;
  if (r.torrentUrl) out.torrentUrl = r.torrentUrl;
  return out;
}

export function rememberBestRelease(id: string, result: SourceResult): void {
  const all = loadJson<Record<string, SourceResult>>(KEY, {}, (v) => !!v && typeof v === 'object' && !Array.isArray(v));
  const next: Record<string, SourceResult> = {};
  Object.keys(all).forEach((k) => {
    if (k !== id) next[k] = all[k];
  });
  next[id] = slim(result);
  const live: { [id: string]: boolean } = {};
  loadSubs().forEach((s) => {
    live[s.id] = true;
  });
  Object.keys(next).forEach((k) => {
    if (!live[k]) delete next[k];
  });
  saveJson(KEY, next);
}

export function forgetBestRelease(id: string): void {
  const all = loadJson<Record<string, SourceResult>>(KEY, {}, (v) => !!v && typeof v === 'object' && !Array.isArray(v));
  if (!all[id]) return;
  delete all[id];
  saveJson(KEY, all);
}

export function bestRelease(id: string): SourceResult | null {
  const all = loadJson<Record<string, SourceResult>>(KEY, {}, (v) => !!v && typeof v === 'object' && !Array.isArray(v));
  return all[id] || null;
}
