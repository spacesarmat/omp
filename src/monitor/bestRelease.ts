// The best release a «Только лучшее качество» check saw, including one below the notification floor.
// It is not a finding, so it does not notify.
import { loadJson, saveJson } from '../store/storage';
import type { SourceResult } from '../sources/types';

const KEY = 'tsp.subBest';
const MAX = 40;

function slim(r: SourceResult): SourceResult {
  return {
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
}

export function rememberBestRelease(id: string, result: SourceResult): void {
  const all = loadJson<Record<string, SourceResult>>(KEY, {}, (v) => !!v && typeof v === 'object' && !Array.isArray(v));
  const next: Record<string, SourceResult> = {};
  Object.keys(all).forEach((k) => {
    if (k !== id) next[k] = all[k];
  });
  next[id] = slim(result);
  const keys = Object.keys(next);
  while (keys.length > MAX) {
    const drop = keys.shift();
    if (drop) delete next[drop];
  }
  saveJson(KEY, next);
}

export function bestRelease(id: string): SourceResult | null {
  const all = loadJson<Record<string, SourceResult>>(KEY, {}, (v) => !!v && typeof v === 'object' && !Array.isArray(v));
  return all[id] || null;
}
