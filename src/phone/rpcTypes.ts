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
