// Community rank from billing (/v1/search omp_rank). Added on top of rankScore (src/sources/seedRank.ts).
// PR 335's smartScore calls rankScore, so a merge picks this bonus up instead of a second sorter.
// Chromium 53 safe: no ?., no ??, no regex u flag.
import { t } from '../i18n';

const BOOST = 50000000;
/**
 * What billing can send: scoreOf gives its 0..100 score times 100, and an admin pin adds a band of 100000 on
 * top, so the honest numbers run from 0 to 110000 and a pinned row always sits above an ordinary one.
 * Anything outside that did not come from billing's decision - an indexer can put any number in an attribute -
 * and it must not buy more place than the most honest row has.
 */
const RANK_MIN = 0;
const RANK_MAX = 110000;

export interface CommunityRow {
  communityRank?: number;
  communityReason?: string;
  suggestedVoice?: string;
}

/** Large enough to sit above the seed-check score. 0 when billing did not mark a learned row. */
export function communityBoost(r: CommunityRow | null | undefined): number {
  if (!r) return 0;
  const reason = r.communityReason;
  if (reason !== 'community' && reason !== 'blend' && reason !== 'pinned' && reason !== 'seeds' && reason !== 'dht') return 0;
  if (typeof r.communityRank !== 'number' || !isFinite(r.communityRank)) return 0;
  const rank = Math.round(r.communityRank);
  return BOOST + Math.max(RANK_MIN, Math.min(RANK_MAX, rank)) * 100;
}

/** Short reason for the row. Empty when billing left the ordinary seed order. */
export function communityLabel(r: CommunityRow | null | undefined): string {
  if (!r) return '';
  let head = '';
  if (r.communityReason === 'community') head = t('search.rankCommunity');
  else if (r.communityReason === 'blend') head = t('search.rankBlend');
  else if (r.communityReason === 'pinned') head = t('search.rankPinned');
  const voice = r.suggestedVoice ? t('search.rankVoice', { name: r.suggestedVoice }) : '';
  if (head && voice) return head + ' · ' + voice;
  return head || voice;
}

const byHash: { [k: string]: string } = {};
const byTitle: { [k: string]: string } = {};

function norm(title: string): string {
  return (title || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function rememberCommunityVoice(hash: string | undefined, title: string | undefined, voice: string | undefined): void {
  const v = (voice || '').trim().slice(0, 40);
  if (!v) return;
  const h = (hash || '').toLowerCase();
  if (h) byHash[h] = v;
  const n = norm(title || '');
  if (n) byTitle[n] = v;
}

export function communityVoiceFor(hash: string | undefined, title: string | undefined): string {
  const h = (hash || '').toLowerCase();
  if (h && byHash[h]) return byHash[h];
  const n = norm(title || '');
  return n && byTitle[n] ? byTitle[n] : '';
}

export function clearCommunityVoices(): void {
  const hashes = Object.keys(byHash);
  for (let i = 0; i < hashes.length; i++) delete byHash[hashes[i]];
  const titles = Object.keys(byTitle);
  for (let i = 0; i < titles.length; i++) delete byTitle[titles[i]];
}
