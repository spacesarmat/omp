// The wire shapes of the phone's TV search server (mobile/src/rpc/handler.ts answers them, src/phone/rpc.ts and
// src/phone/phoneSearch.ts on the TV parse them): one copy shared by both sides, so the TV never imports from mobile/.

export type RpcSourceState = 'ok' | 'loggedIn' | 'login' | 'cloudflare' | 'error' | 'off' | 'unknown';

export interface RpcSource {
  id: string;
  name: string;
  on: boolean;
  state: RpcSourceState;
  message?: string;
}

/** A trimmed SourceResult: no Link, no detailUrl (the TV never fetches the phone's pages). */
export interface RpcResult {
  /** Opaque id of the row within its search (never a URL); `resolve` takes it. */
  key: string;
  Title: string;
  Size: string;
  sizeBytes?: number;
  Seed: number;
  Peer: number;
  Tracker: string;
  CreateDate: string;
  /** dd.mm.yyyy of the release: a display string, unlike SourceResult.date (unix ms). Sort by CreateDate. */
  date?: string;
  Categories: string;
  Magnet: string;
  Hash: string;
  source: string;
  sources?: string[];
}

export interface RpcFailure {
  id: string;
  message: string;
  /** 'login': the source needs a sign-in on the phone. */
  code?: 'ipban' | 'tls' | 'cloudflare' | 'login';
}

export interface RpcPoll {
  rev: number;
  done: boolean;
  pending: string[];
  answered: string[];
  failed: RpcFailure[];
  /** Only when `rev` differs from the one the TV sent. */
  results?: RpcResult[];
}

// --- monitoring (the new-findings feed and subscriptions on the TV)

export type RpcFindingKind = 'episodes' | 'better' | 'sub';

export interface RpcFinding {
  subId: string;
  key: string;
  kind: RpcFindingKind;
  /** Found at, unix ms. */
  at: number;
  seen: boolean;
  /** The same fields as a search row; `key` is the finding key (`findingLink` takes subId + key). */
  result: RpcResult;
  /** The subscription query, or the library torrent title for episodes / better. */
  title: string;
  episodes?: { torrentHash: string; season: number; from?: number; to: number };
  better?: { torrentHash: string; have: string; got: string };
}

export interface RpcSub {
  id: string;
  query: string;
  quality: '' | '720' | '1080' | '2160';
  notify: boolean;
  better: boolean;
  /** Findings not looked at yet. */
  unseen: number;
  /** A `subCheck` of it is running. */
  checking: boolean;
  createdAt: number;
}

export interface RpcFeed {
  /** Newest first, at most FOUND_MAX. */
  findings: RpcFinding[];
  /** Unix ms of the last background check, null before the first. */
  lastRun: number | null;
}
