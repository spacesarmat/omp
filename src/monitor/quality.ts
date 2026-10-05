// «Лучшее качество» (v0.17): the quality order of release titles. Resolution first (720 < 1080 < 2160), then the
// source at the same resolution: camrip/TS < unknown < WEB-DL/WEBRip < BDRip/BluRay/HDRip < Remux. Pure and shared;
// Chromium 53 safe.
import { displayBadge } from '../lib/releaseInfo';
import { parseRelease, type ReleaseInfo } from '../sources/filters';

const RES_STEP: { [res: string]: number } = { '0': 0, '720': 1, '1080': 2, '2160': 3 };
const SOURCE_LABEL: { [source: string]: string } = { web: 'WEB-DL', bdrip: 'BDRip', remux: 'Remux' };

/** 0 camrip/TS, 1 unknown, 2 WEB-DL/WEBRip, 3 BDRip/BluRay/HDRip, 4 Remux. */
function sourceStep(i: ReleaseInfo): number {
  if (i.cam) return 0;
  if (i.source === 'remux') return 4;
  if (i.source === 'bdrip') return 3;
  if (i.source === 'web') return 2;
  return 1;
}

/** Resolution step × 10 + source step (0…34): higher is better. An unknown resolution counts as the lowest step. */
export function qualityRank(title: string): number {
  const i = parseRelease(title);
  return RES_STEP[String(i.res)] * 10 + sourceStep(i);
}

/**
 * `candidate` is a better release than `have`.
 * - Both resolutions known: the higher resolution wins; at the same resolution the better source does (so a non-camrip
 *   beats a camrip).
 * - Both resolutions unknown (0): only the source decides.
 * - One side unknown: an unknown resolution says nothing about the picture, so a known resolution wins only over an
 *   unknown-resolution camrip (and only when it is no camrip itself); an unknown-resolution candidate never beats a
 *   known one.
 */
export function isBetter(candidate: string, have: string): boolean {
  const c = parseRelease(candidate);
  const h = parseRelease(have);
  if (c.res && h.res) return c.res > h.res || (c.res === h.res && sourceStep(c) > sourceStep(h));
  if (!c.res && !h.res) return sourceStep(c) > sourceStep(h);
  if (c.res) return h.cam && !c.cam;
  return false;
}

/** Short label for the user: «1080p WEB-DL», «4K Remux», «CAMRip»; '' when the title says nothing about the quality. */
export function qualityLabel(title: string): string {
  const i = parseRelease(title);
  const parts: string[] = [];
  if (i.res) parts.push(displayBadge(i.res + 'p'));
  if (i.cam) parts.push('CAMRip');
  else if (i.source) parts.push(SOURCE_LABEL[i.source]);
  return parts.join(' ');
}
