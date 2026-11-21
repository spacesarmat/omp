import { BILLING_ORIGIN } from './config';
import { billingSession, deviceId, type BillingAccount } from './session';
import { canUseV2 } from './syncV2Capabilities';
import { createSyncSocketClient, type SyncSocketClient } from './syncSocketClient';
import { publishSyncV2Result, refreshSyncV2Status, updateSyncV2Status } from './syncV2Status';
import { withDeviceToken } from './tokens';
import type { HttpOptions, SourceContext } from '../sources/types';
import {
  ackSent, markSyncError, markSynced, putDeviceRecords, unsentRecords,
} from '../store/deviceDb';
import { applyPulled } from '../store/applyPulled';
import {
  ackV2, blockV2Mutation, dropV2Mutation, enqueueUnsent, mergeV2Pulled, readV2Meta, readV2Outbox, writeV2Meta,
  type OutboxRow, type SyncRecordV2,
} from '../store/deviceV2Db';
import type { SyncRecord } from '../store/syncMerge';

export interface V2Ack { recordId: string; mutationId: string; revision: number }
export interface V2Answer { ok?: boolean; records?: SyncRecordV2[]; nextRevision?: number; ack?: V2Ack[]; error?: string }
interface V2Response { status: number; data: V2Answer }

let contextOf: (() => SourceContext | null) | null = null;

export function setV2SyncContext(fn: (() => SourceContext | null) | null): void {
  contextOf = fn;
}

interface CachedAccount { at: number; account: BillingAccount | null }
const accountCache = new Map<string, CachedAccount>();

export function resetV2AccountCache(): void {
  accountCache.clear();
}

function browserContext(): SourceContext {
  const get = (url: string, opts?: HttpOptions) => fetch(url, { headers: opts && opts.headers }).then(
    async (res) => ({ status: res.status, url: res.url, text: await res.text() }),
  );
  return {
    http: {
      get,
      post: () => Promise.reject(new Error('not_supported')),
      clearCookies: () => Promise.resolve(),
    },
    client: null,
  };
}

function fetchSyncAccount(ctx: SourceContext): Promise<BillingAccount | null> {
  return withDeviceToken(ctx, (headers) => ctx.http.get(BILLING_ORIGIN + '/v1/me', { headers, timeoutMs: 12000 })).then((res) => {
    if (res.status !== 200) return null;
    try {
      const body = JSON.parse(res.text || '{}');
      const sync = body.sync && typeof body.sync === 'object' && typeof body.sync.allowed === 'boolean'
        ? {
            audience: body.sync.audience === 'all' ? 'all' as const : 'subscribers' as const,
            allowed: body.sync.allowed,
            v2: body.sync.v2 !== false,
          }
        : undefined;
      return {
        telegramId: typeof body.telegramId === 'string' ? body.telegramId : '',
        paidUntil: Number(body.paidUntil) || 0,
        active: body.active === true,
        deviceLimit: Number(body.deviceLimit) || 0,
        sync,
      };
    } catch (e) {
      return null;
    }
  });
}

export async function shouldUseV2(owner: string, isOwner: () => boolean): Promise<boolean> {
  if (!isOwner()) return false;
  const cached = accountCache.get(owner);
  let account = cached && Date.now() - cached.at < 60000 ? cached.account : undefined;
  if (account === undefined) {
    const ctx = contextOf && contextOf() || browserContext();
    account = await fetchSyncAccount(ctx).catch(() => null);
    if (!isOwner()) return false;
    accountCache.set(owner, { at: Date.now(), account });
  }
  return canUseV2(account);
}

function accessToken(): string {
  const session = billingSession();
  return session ? session.access || session.token : '';
}

function parseAnswer(status: number, text: string): V2Response {
  try {
    const data = JSON.parse(text || '{}');
    return { status, data: data && typeof data === 'object' ? data : {} };
  } catch (e) {
    return { status, data: {} };
  }
}

function postV2(owner: string, since: number, records: SyncRecordV2[], isOwner: () => boolean): Promise<V2Response> {
  if (!isOwner()) return Promise.resolve({ status: 0, data: { error: 'switched' } });
  const body = JSON.stringify({ since, records });
  const ctx = contextOf && contextOf();
  if (ctx && ctx.http.postJson) {
    const postJson = ctx.http.postJson;
    return withDeviceToken(ctx, (headers) => {
      if (!isOwner()) return Promise.resolve({ status: 0, url: '', text: '{"error":"switched"}' });
      return postJson(BILLING_ORIGIN + '/v2/sync', body, { headers, timeoutMs: 20000 });
    }).then((res) => parseAnswer(res.status, res.text), () => ({ status: 0, data: {} }));
  }
  if (!accessToken()) return Promise.resolve({ status: 0, data: {} });
  return fetch(BILLING_ORIGIN + '/v2/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + accessToken(), 'x-device-id': deviceId() },
    body,
  }).then(
    (res) => res.json().then((data) => ({ status: res.status, data: data || {} }), () => ({ status: res.status, data: {} })),
    () => ({ status: 0, data: {} }),
  );
}

export async function acceptV2Page(owner: string, answer: V2Answer, sent: OutboxRow[]): Promise<{ blocked: number; revision: number }> {
  const acks = Array.isArray(answer.ack) ? answer.ack : [];
  await ackV2(acks, sent.map((item) => item.row));
  const ackIds = new Set(acks.map((ack) => ack.mutationId));
  const ackedRows: SyncRecord[] = [];
  let blocked = 0;
  for (const item of sent) {
    if (ackIds.has(item.mutationId)) ackedRows.push(item.row);
    else {
      await blockV2Mutation(item.mutationId, 'not_accepted');
      blocked++;
    }
  }
  if (ackedRows.length) ackSent(ackedRows);
  const incoming = Array.isArray(answer.records) ? answer.records : [];
  if (incoming.length) {
    const merged = await mergeV2Pulled(incoming);
    const stored = putDeviceRecords(incoming, true);
    const won: SyncRecord[] = [];
    for (const row of incoming) {
      const kept = stored.find((item) => item.id === row.id);
      if (kept && kept.updatedAt === row.updatedAt && kept.deviceId === row.deviceId) won.push(kept);
    }
    if (won.length) applyPulled(won);
    void merged;
  }
  const previous = await readV2Meta(owner);
  const revision = Math.max(previous.revision, Number(answer.nextRevision) || 0);
  if (revision !== previous.revision) await writeV2Meta(owner, { revision });
  await refreshSyncV2Status(owner);
  return { blocked, revision };
}

interface BatchResult { status: string; full: boolean }

async function sendBatch(owner: string, since: number, rows: OutboxRow[], isOwner: () => boolean): Promise<BatchResult> {
  if (!isOwner()) return { status: 'error', full: false };
  const ans = await postV2(owner, since, rows.map((item) => item.row), isOwner);
  if ((ans.status === 409 || ans.status === 400) && rows.length > 1) {
    const middle = Math.ceil(rows.length / 2);
    const left = await sendBatch(owner, since, rows.slice(0, middle), isOwner);
    if (left.status === 'offline' || left.status === 'v1' || left.status === 'denied' || left.status === 'error') return left;
    const right = await sendBatch(owner, since, rows.slice(middle), isOwner);
    return { status: left.status === 'recovery' || right.status === 'recovery' ? 'recovery' : right.status, full: left.full || right.full };
  }
  if (ans.status === 409 && rows.length === 1) {
    await dropV2Mutation(rows[0].mutationId);
    markSyncError('expired');
    return { status: 'recovery', full: false };
  }
  if (ans.status === 400 && rows.length === 1) {
    await blockV2Mutation(rows[0].mutationId, 'bad_record');
    markSyncError('error');
    return { status: 'recovery', full: false };
  }
  if (ans.status === 404 || ans.status === 405 || ans.status === 503) return { status: 'v1', full: false };
  if (ans.status === 403) {
    markSyncError('denied');
    return { status: 'denied', full: false };
  }
  if (ans.status === 0) {
    markSyncError(ans.data.error === 'switched' ? 'error' : 'offline');
    return { status: ans.data.error === 'switched' ? 'error' : 'offline', full: false };
  }
  if (ans.status !== 200 || !ans.data.ok || !isOwner()) return { status: 'error', full: false };
  const accepted = await acceptV2Page(owner, ans.data, rows);
  return { status: accepted.blocked ? 'recovery' : 'ok', full: (ans.data.records || []).length >= 500 };
}

async function runV2Http(owner: string, epoch: number, isOwner: () => boolean): Promise<string> {
  await enqueueUnsent(unsentRecords(epoch), owner);
  let recovery = false;
  for (let page = 0; page < 100; page++) {
    if (!isOwner()) return 'error';
    const meta = await readV2Meta(owner);
    const pending = (await readV2Outbox(owner)).filter((row) => !row.blocked);
    const result = await sendBatch(owner, meta.revision, pending.slice(0, 200), isOwner);
    if (result.status === 'offline' || result.status === 'v1' || result.status === 'denied' || result.status === 'error') return result.status;
    if (result.status === 'recovery') recovery = true;
    const nextMeta = await readV2Meta(owner);
    const remaining = (await readV2Outbox(owner)).some((row) => !row.blocked);
    if (!remaining && !result.full) break;
    if (result.full && nextMeta.revision <= meta.revision) return 'error';
  }
  if (recovery) return 'error';
  const blocked = (await readV2Outbox(owner)).some((row) => row.blocked);
  if (blocked) return 'error';
  markSynced(Date.now());
  return 'ok';
}

let socketClient: SyncSocketClient | null = null;
let socketOwner = '';

export function stopV2Socket(): void {
  if (socketClient) socketClient.stop();
  socketClient = null;
  socketOwner = '';
}

export function isV2SocketReady(): boolean {
  return !!socketClient && socketClient.isReady();
}

function socketFor(owner: string, epoch: number, isOwner: () => boolean): SyncSocketClient | null {
  if (typeof WebSocket === 'undefined') return null;
  if (socketClient && socketOwner === owner) return socketClient;
  stopV2Socket();
  socketOwner = owner;
  socketClient = createSyncSocketClient({
    owner,
    deviceId: deviceId(),
    token: accessToken,
    isOwner,
    readMeta: readV2Meta,
    readOutbox: readV2Outbox,
    accept: (answer, sent) => acceptV2Page(owner, answer, sent),
    fallback: () => runV2Http(owner, epoch, isOwner),
    block: blockV2Mutation,
    socketFactory: (url) => new WebSocket(url) as any,
    onStatus: (status) => {
      if (status === 'http') updateSyncV2Status({ transport: 'http' });
      else if (status === 'offline') updateSyncV2Status({ lastError: 'offline' });
      else updateSyncV2Status({ transport: 'websocket', lastAt: Date.now(), lastError: '' });
      void refreshSyncV2Status(owner).catch(() => undefined);
    },
  });
  return socketClient;
}

export async function runV2(owner: string, epoch: number, isOwner: () => boolean): Promise<string> {
  if (!isOwner()) return 'error';
  const client = socketFor(owner, epoch, isOwner);
  let status: string;
  if (client && client.isReady()) {
    await enqueueUnsent(unsentRecords(epoch), owner);
    status = await client.sync();
    if (status === 'ok') markSynced(Date.now());
    else if (status !== 'offline' && status !== 'denied') markSyncError(status);
  } else {
    status = await runV2Http(owner, epoch, isOwner);
    if (status === 'ok' && client && isOwner()) client.start();
  }
  const transport = status === 'v1' ? 'v1' : client && client.isReady() ? 'websocket' : 'http';
  publishSyncV2Result(owner, status, transport);
  return status;
}
