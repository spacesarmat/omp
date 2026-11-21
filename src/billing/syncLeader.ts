const TTL = 15000;
const REFRESH = 5000;
let sequence = 0;

interface Lease { owner: string; at: number }
interface BusMessage { type: string; from: string; value?: unknown }
export interface SyncLeader {
  start(): void;
  stop(): void;
  request(): void;
  isLeader(): boolean;
}

export function createSyncLeader(options: { deviceId: string; run: () => unknown; publish: (status: unknown) => void }): SyncLeader {
  const owner = options.deviceId + ':' + (++sequence) + ':' + Math.random().toString(36).slice(2, 8);
  const leaseKey = 'omp.syncV2Leader:' + options.deviceId;
  const busKey = 'omp.syncV2Bus:' + options.deviceId;
  let leader = false;
  let started = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let channel: BroadcastChannel | null = null;

  function readLease(): Lease | null {
    try {
      const value = JSON.parse(localStorage.getItem(leaseKey) || 'null');
      return value && typeof value.owner === 'string' && typeof value.at === 'number' ? value : null;
    } catch (e) {
      return null;
    }
  }

  function acquire(): void {
    const current = readLease();
    const at = Date.now();
    if (current && current.owner !== owner && at - current.at < TTL) {
      leader = false;
      return;
    }
    leader = true;
    localStorage.setItem(leaseKey, JSON.stringify({ owner, at }));
  }

  function post(message: BusMessage): void {
    if (channel) channel.postMessage(message);
    else localStorage.setItem(busKey, JSON.stringify({ ...message, nonce: Math.random() }));
  }

  function execute(): void {
    if (!leader) return;
    Promise.resolve().then(() => options.run()).then(
      (status) => {
        options.publish(status);
        post({ type: 'status', from: owner, value: status });
      },
      () => {
        options.publish('error');
        post({ type: 'status', from: owner, value: 'error' });
      },
    );
  }

  function receive(message: BusMessage): void {
    if (!message || message.from === owner) return;
    if (message.type === 'request') execute();
    if (message.type === 'status') options.publish(message.value);
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== busKey || !event.newValue) return;
    try { receive(JSON.parse(event.newValue)); } catch (e) { /* malformed bus event */ }
  }

  function refresh(): void {
    if (!leader) {
      acquire();
      if (leader) execute();
      return;
    }
    const current = readLease();
    if (!current || current.owner !== owner) {
      leader = false;
      return;
    }
    localStorage.setItem(leaseKey, JSON.stringify({ owner, at: Date.now() }));
  }

  function start(): void {
    if (started) return;
    started = true;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('omp-sync-v2:' + options.deviceId);
      channel.onmessage = (event) => receive(event.data as BusMessage);
    } else {
      window.addEventListener('storage', onStorage);
    }
    window.addEventListener('pagehide', stop);
    acquire();
    timer = setInterval(refresh, REFRESH);
  }

  function stop(): void {
    if (!started) return;
    started = false;
    if (timer) clearInterval(timer);
    timer = null;
    window.removeEventListener('pagehide', stop);
    window.removeEventListener('storage', onStorage);
    if (channel) channel.close();
    channel = null;
    const current = readLease();
    if (current && current.owner === owner) localStorage.removeItem(leaseKey);
    leader = false;
  }

  return {
    start,
    stop,
    request() {
      if (!started) start();
      if (leader) execute();
      else post({ type: 'request', from: owner });
    },
    isLeader: () => leader,
  };
}
