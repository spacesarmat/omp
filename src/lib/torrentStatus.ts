// The torrent screen's status line in the UI language (size, state, speed, peers) instead of TorrServer's English
// "Torrent working" and "0 B/s".
import type { Torrent } from '../api/types';
import { t, tp, fmtBytes, fmtSpeed, type Key } from '../i18n';
import { trackerSeedsOf } from './journal';

/** TorrServer's states by `stat` (TorrentAdded … TorrentInDB). */
const BY_STAT: Key[] = ['torrent.stat.added', 'torrent.stat.info', 'torrent.stat.preload', 'torrent.stat.working', 'torrent.stat.closed', 'torrent.stat.db'];

/** TorrServer's `stat_string` values, lowercased, to the same states. */
const BY_TEXT: { [s: string]: number } = {
  'torrent added': 0,
  'torrent getting info': 1,
  'torrent preload': 2,
  'torrent working': 3,
  'torrent closed': 4,
  'torrent in db': 5,
};

/** The state in the UI language; an unknown TorrServer string stays as it is, '' for none. */
export function statusText(stat: number | undefined, text: string | undefined): string {
  const raw = (text || '').trim();
  const low = raw.toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(BY_TEXT, low) ? BY_TEXT[low] : undefined;
  const n = known !== undefined ? known : raw ? -1 : typeof stat === 'number' ? stat : -1;
  if (n >= 0 && n < BY_STAT.length) return t(BY_STAT[n]);
  return raw;
}

/** The size, the state, and while working the speed and the peers, joined with ' · '. */
export function statusLine(tor: Pick<Torrent, 'stat' | 'stat_string' | 'torrent_size' | 'download_speed' | 'active_peers' | 'total_peers'>): string {
  const parts: string[] = [];
  if (tor.torrent_size) parts.push(fmtBytes(tor.torrent_size));
  const state = statusText(tor.stat, tor.stat_string);
  if (state) parts.push(state);
  if (tor.stat === 3) {
    parts.push(fmtSpeed(tor.download_speed || 0));
    parts.push(t('torrent.peers', { a: tor.active_peers || 0, b: tor.total_peers || 0 }));
  }
  return parts.join(' · ');
}

/** Getting info, preloading, or working: TorrServer's live swarm, not the idle 0/0 snapshot. */
export function swarmActive(stat: number | undefined): boolean {
  return stat === 1 || stat === 2 || stat === 3;
}

/**
 * Seeds line of a library card. Active: «подключено: N сидов · M пиров» from TorrServer.
 * Idle: the tracker count saved at add time («44 сида (трекер)»), or «—» when that was never saved.
 */
export function swarmText(tor: { stat?: number; connected_seeders?: number; active_peers?: number; data?: string }): string {
  if (swarmActive(tor.stat)) {
    return t('torrent.connected') + ' ' + tp('sources.seeds', tor.connected_seeders || 0) + ' · ' + tp('torrent.screen.peerCount', tor.active_peers || 0);
  }
  const saved = trackerSeedsOf(tor.data);
  if (saved) return tp('sources.seeds', saved.s) + ' ' + t('torrent.trackerMark');
  return t('torrent.seedsUnknown');
}

/** The phone's seeds line: '' instead of the bare «-» placeholder, so a meta line does not end in a dangling «· -». */
export function knownSwarmText(tor: { stat?: number; connected_seeders?: number; active_peers?: number; data?: string }): string {
  const s = swarmText(tor);
  return s === t('torrent.seedsUnknown') ? '' : s;
}

/** Joins the parts that are actually there. An empty part or the bare «-» placeholder is dropped, separator too. */
export function joinMeta(parts: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const s = (parts[i] || '').trim();
    if (!s || s === '-') continue;
    out.push(s);
  }
  return out.join(' · ');
}
