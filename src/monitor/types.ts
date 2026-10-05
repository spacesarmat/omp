// Monitoring (v0.13): subscriptions to a search and new episodes of the library series. Shared by the phone app and
// its background page; Chromium 53 safe.
import type { SourceResult } from '../sources/types';

/** Quality of a subscription: '' any, '720' 720p and better, '1080' 1080p and better, '2160' 2160p. */
export type SubQuality = '' | '720' | '1080' | '2160';

export interface Subscription {
  id: string;
  /** Search query. */
  query: string;
  quality: SubQuality;
  /** Minimum seeds (absent: any). */
  minSeeds?: number;
  /** Maximum size, GB (absent: any). */
  maxSizeGb?: number;
  /** Source ids to search; null = every switched-on source. */
  sources: string[] | null;
  /** «Уведомлять». */
  notify: boolean;
  /** «Только лучшее качество»: of the new results only the best is reported, and only above every rank reported before. */
  better?: boolean;
  /** Unix ms. */
  createdAt: number;
}

/** The fields a new subscription is created from. */
export type SubscriptionInput = Pick<Subscription, 'query' | 'quality' | 'sources' | 'notify'> &
  Partial<Pick<Subscription, 'minSeeds' | 'maxSizeGb' | 'better'>>;

/** subId of the findings of new episodes (not a subscription). */
export const EPISODES_ID = 'episodes';

/** New episodes of a library series: «Вышли серии 9–10 · у вас 1–8». */
export interface EpisodesInfo {
  /** Infohash of the library torrent (lowercase). */
  torrentHash: string;
  /** Title of the library torrent. */
  torrentTitle: string;
  season: number;
  /** Last episode the library torrent has. */
  haveTo: number;
  /** Range of the new release. */
  from?: number;
  to: number;
}

/** subId of the findings of better releases of library films (not a subscription). */
export const BETTER_ID = 'better';

/** A library film came out in better quality: «4K WEB-DL · у вас 1080p WEB-DL». */
export interface BetterInfo {
  /** Infohash of the library torrent (lowercase). */
  torrentHash: string;
  /** Title of the library torrent. */
  torrentTitle: string;
  /** qualityLabel of the library torrent ('' when its title says nothing). */
  have: string;
  /** qualityLabel of the release found. */
  got: string;
}

export interface Finding {
  /** Subscription id, EPISODES_ID or BETTER_ID. */
  subId: string;
  /** Seen key of the result (subscriptions), `<hash>:<season>:<to>` (new episodes) or `<hash>:<rank>` (better quality). */
  key: string;
  result: SourceResult;
  /** Found at, unix ms. */
  at: number;
  /** Looked at on the screen (absent: new). */
  seen?: boolean;
  /** For EPISODES_ID findings. */
  episodes?: EpisodesInfo;
  /** For BETTER_ID findings. */
  better?: BetterInfo;
}
