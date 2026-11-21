import { BILLING_ORIGIN } from './config';
import type { OutboxRow } from '../store/deviceV2Db';

interface SocketAnswer {
  records?: any[];
  nextRevision?: number;
  ack?: Array<{ recordId: string; mutationId: string; revision: number }>;
}
interface SocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number): void;
}
export interface SyncSocketClient {
  start(): void;
  sync(): Promise<string>;
  stop(): void;
  isReady(): boolean;
  hasInFlight(mutationId: string): boolean;
}
interface Options {
  owner: string;
  deviceId: string;
  token: () => string;
  isOwner: () => boolean;
  readMeta: (owner: string) => Promise<{ revision: number }>;
  readOutbox: (owner: string) => Promise<OutboxRow[]>;
  accept: (answer: SocketAnswer, sent: OutboxRow[]) => Promise<{ blocked: number; revision: number }>;
  fallback: () => Promise<string>;
  block?: (mutationId: string, reason: string) => Promise<void>;
  socketFactory: (url: string) => SocketLike;
  ackTimeoutMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  random?: () => number;
  onStatus?: (status: string) => void;
}

const encoder = new TextEncoder();
function bytes(rows: OutboxRow[]): number {
  return encoder.encode(JSON.stringify(rows.map((row) => row.row))).length;
}

export function chunkSocketMutations(rows: OutboxRow[]): OutboxRow[][] {
  const chunks: OutboxRow[][] = [];
  let current: OutboxRow[] = [];
  for (const row of rows) {
    const next = current.concat(row);
    if (current.length && (next.length > 200 || bytes(next) > 7500)) {
      chunks.push(current);
      current = [row];
    } else current = next;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function reconnectDelay(attempt: number, random: number, min = 1000, max = 30000): number {
  const base = Math.min(max, min * Math.pow(2, Math.max(0, attempt)));
  return Math.max(min, Math.min(max, Math.round(base * (0.5 + Math.max(0, Math.min(1, random))))));
}

export function createSyncSocketClient(options: Options): SyncSocketClient {
  const ackTimeoutMs = options.ackTimeoutMs || 20000;
  const reconnectMinMs = options.reconnectMinMs || 1000;
  const reconnectMaxMs = options.reconnectMaxMs || 30000;
  const random = options.random || Math.random;
  const inFlight = new Set<string>();
  let socket: SocketLike | null = null;
  let connecting: Promise<void> | null = null;
  let connectResolve: (() => void) | null = null;
  let connectReject: ((error: Error) => void) | null = null;
  let authToken = '';
  let resumed = false;
  let stopped = true;
  let active: Promise<string> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let flight: {
    rows: OutboxRow[];
    resolve: (status: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  function clearFlight(): { rows: OutboxRow[]; resolve: (status: string) => void; reject: (error: Error) => void } | null {
    const current = flight;
    if (!current) return null;
    clearTimeout(current.timer);
    flight = null;
    for (const row of current.rows) inFlight.delete(row.mutationId);
    return current;
  }

  function failConnect(error: Error): void {
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = null;
    if (connectReject) connectReject(error);
    connectResolve = null;
    connectReject = null;
    connecting = null;
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer || !options.isOwner()) return;
    const delay = reconnectDelay(reconnectAttempt++, random(), reconnectMinMs, reconnectMaxMs);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped && !active) void connect().catch(() => undefined);
    }, delay);
  }

  function closed(current: SocketLike): void {
    if (socket !== current) return;
    socket = null;
    resumed = false;
    const pending = clearFlight();
    if (pending) pending.reject(new Error('socket_closed'));
    failConnect(new Error('socket_closed'));
    options.onStatus && options.onStatus('offline');
    if (!pending && !active) scheduleReconnect();
  }

  async function changed(message: any): Promise<void> {
    if (!options.isOwner()) return;
    await options.accept({ records: Array.isArray(message.records) ? message.records : [], nextRevision: message.nextRevision }, []);
    if (message.hasMore) return;
    if (!resumed) {
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;
      resumed = true;
      reconnectAttempt = 0;
      if (connectResolve) connectResolve();
      connectResolve = null;
      connectReject = null;
      connecting = null;
    }
    options.onStatus && options.onStatus('ok');
  }

  async function acknowledged(message: any): Promise<void> {
    const pending = clearFlight();
    if (!pending || !options.isOwner()) return;
    try {
      const accepted = await options.accept({ ack: Array.isArray(message.ack) ? message.ack : [] }, pending.rows);
      pending.resolve(accepted.blocked ? 'error' : 'ok');
    } catch (error) {
      pending.reject(error as Error);
    }
  }

  function message(event: { data: string }): void {
    let data: any;
    try { data = JSON.parse(event.data); } catch (error) { return; }
    if (!data || typeof data.type !== 'string') return;
    if (data.type === 'ready') {
      void options.readMeta(options.owner).then((meta) => {
        if (socket && socket.readyState === 1 && options.isOwner()) socket.send(JSON.stringify({ type: 'resume', since: meta.revision }));
      }, () => closed(socket!));
      return;
    }
    if (data.type === 'changes') {
      void changed(data).catch(() => socket && closed(socket));
      return;
    }
    if (data.type === 'ack') {
      void acknowledged(data);
      return;
    }
    if (data.type === 'error' && flight) {
      const pending = clearFlight();
      if (pending) pending.reject(new Error(String(data.code || 'mutation_failed')));
    }
  }

  function connect(): Promise<void> {
    if (!options.isOwner()) return Promise.reject(new Error('not_owner'));
    const currentToken = options.token();
    if (!currentToken) return Promise.reject(new Error('no_token'));
    if (socket && authToken === currentToken && resumed && socket.readyState === 1) return Promise.resolve();
    if (connecting && authToken === currentToken) return connecting;
    if (socket) {
      const previous = socket;
      socket = null;
      resumed = false;
      previous.close(1000);
    }
    stopped = false;
    resumed = false;
    authToken = currentToken;
    let current: SocketLike;
    try {
      current = options.socketFactory(BILLING_ORIGIN.replace(/^http/, 'ws') + '/v2/sync/ws');
    } catch (error) {
      return Promise.reject(error as Error);
    }
    socket = current;
    connecting = new Promise<void>((resolve, reject) => {
      connectResolve = resolve;
      connectReject = reject;
      current.onopen = () => current.send(JSON.stringify({ type: 'auth', token: currentToken, deviceId: options.deviceId }));
      current.onmessage = message;
      current.onclose = () => closed(current);
      current.onerror = () => undefined;
    });
    connectTimer = setTimeout(() => {
      if (socket !== current || resumed) return;
      try { current.close(1000); } catch (error) { /* close can fail while connecting */ }
      if (socket === current) closed(current);
    }, ackTimeoutMs);
    return connecting;
  }

  function send(rows: OutboxRow[]): Promise<string> {
    if (!socket || socket.readyState !== 1 || !resumed) return Promise.reject(new Error('socket_not_ready'));
    return new Promise<string>((resolve, reject) => {
      for (const row of rows) inFlight.add(row.mutationId);
      const timer = setTimeout(() => {
        const pending = clearFlight();
        if (pending) pending.reject(new Error('ack_timeout'));
      }, ackTimeoutMs);
      flight = { rows, resolve, reject, timer };
      socket!.send(JSON.stringify({ type: 'mutations', records: rows.map((row) => row.row) }));
    });
  }

  async function run(): Promise<string> {
    if (!options.isOwner()) return 'error';
    await connect();
    const pending = (await options.readOutbox(options.owner)).filter((row) => !row.blocked);
    let recovered = false;
    for (const chunk of chunkSocketMutations(pending)) {
      if (bytes(chunk) > 7500) {
        recovered = true;
        if (options.block) await options.block(chunk[0].mutationId, 'too_large');
        continue;
      }
      const status = await send(chunk);
      if (status !== 'ok') recovered = true;
    }
    return recovered ? 'error' : 'ok';
  }

  function sync(): Promise<string> {
    if (active) return active;
    stopped = false;
    active = run().catch(() => {
      const pending = clearFlight();
      if (pending) pending.reject(new Error('fallback'));
      if (stopped || !options.isOwner()) return 'error';
      if (socket) {
        const current = socket;
        socket = null;
        current.close(1000);
      }
      resumed = false;
      options.onStatus && options.onStatus('http');
      return options.fallback();
    }).then((status) => {
      if (!stopped) scheduleReconnect();
      return status;
    });
    active = active.finally(() => { active = null; });
    return active;
  }

  return {
    start() {
      if (stopped || !socket) void connect().catch(() => scheduleReconnect());
    },
    sync,
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      const pending = clearFlight();
      if (pending) pending.reject(new Error('stopped'));
      failConnect(new Error('stopped'));
      if (socket) socket.close(1000);
      socket = null;
      resumed = false;
    },
    isReady: () => !!socket && socket.readyState === 1 && resumed,
    hasInFlight: (mutationId) => inFlight.has(mutationId),
  };
}
