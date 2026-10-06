// TV wrappers over the phone's monitor methods («Новое» feed, subscriptions, want, finding links).
// Chromium 53: plain promises, no optional chaining.
import { phoneRpc, PhoneRpcError } from './rpc';
import type { RpcFeed, RpcSub } from './rpcTypes';

export const LINK_TRIES = 8;
export const LINK_GAP_MS = 700;

const ADDABLE = /^(magnet:\?|https?:\/\/)/i;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function phoneFeed(): Promise<RpcFeed> {
  return phoneRpc<RpcFeed>('feed');
}

export function phoneSubs(): Promise<RpcSub[]> {
  return phoneRpc<{ subs: RpcSub[] }>('subs').then((r) => r.subs);
}

export function phoneSubCheck(id: string): Promise<void> {
  return phoneRpc<unknown>('subCheck', { id: id }).then(() => undefined);
}

export function phoneSubSet(id: string, patch: { notify?: boolean; better?: boolean }): Promise<RpcSub> {
  const params: { id: string; notify?: boolean; better?: boolean } = { id: id };
  if (patch.notify !== undefined) params.notify = patch.notify;
  if (patch.better !== undefined) params.better = patch.better;
  return phoneRpc<{ sub: RpcSub }>('subSet', params).then((r) => r.sub);
}

export function phoneSubRemove(id: string): Promise<void> {
  return phoneRpc<unknown>('subRemove', { id: id }).then(() => undefined);
}

export function phoneWantAdd(query: string): Promise<{ sub: RpcSub; created: boolean }> {
  return phoneRpc<{ sub: RpcSub; created: boolean }>('wantAdd', { query: query });
}

/** Asks until the phone has the link (pending: wait 700 ms, at most 8 tries), like resolveTvResult. */
export function phoneFindingLink(subId: string, key: string): Promise<string> {
  const ask = (n: number): Promise<string> =>
    phoneRpc<{ link?: unknown; pending?: unknown }>('findingLink', { subId: subId, key: key }).then((a) => {
      if (a && typeof a.link === 'string') {
        const link = a.link.trim();
        if (ADDABLE.test(link)) return link;
        throw new PhoneRpcError('failed');
      }
      if (a && a.pending === true) {
        if (n >= LINK_TRIES) throw new PhoneRpcError('timeout');
        return wait(LINK_GAP_MS).then(() => ask(n + 1));
      }
      throw new PhoneRpcError('failed');
    });
  return ask(1);
}

export function phoneFindingsSeen(subId?: string, keys?: string[]): Promise<void> {
  const params: { subId?: string; keys?: string[] } = {};
  if (subId !== undefined) params.subId = subId;
  if (keys !== undefined) params.keys = keys;
  return phoneRpc<unknown>('findingsSeen', params).then(() => undefined);
}
