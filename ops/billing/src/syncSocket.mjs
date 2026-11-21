import { WebSocketServer, WebSocket } from 'ws';
import { parseSyncV2Body } from './deviceSyncV2.mjs';

const MAX_ACCOUNT_CONNECTIONS = 20;
const MAX_DEVICE_CONNECTIONS = 5;
const MAX_BUFFERED_AMOUNT = 1024 * 1024;

function cursor(value) {
  const parsed = Math.floor(Number(value) || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function errorCode(error, fallback) {
  return error && typeof error.code === 'string' && error.code ? error.code : fallback;
}

function upgradeError(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
}

export function createSyncSocket(options) {
  const now = options.now || Date.now;
  const bufferedAmount = options.bufferedAmount || ((ws) => ws.bufferedAmount);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  const clients = new Set();
  let closed = false;

  function closeClient(client, code, reason) {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    client.ws.close(code, reason);
  }

  function send(client, message) {
    if (client.ws.readyState !== WebSocket.OPEN) return false;
    if (bufferedAmount(client.ws) > MAX_BUFFERED_AMOUNT) {
      closeClient(client, 1013, 'backpressure');
      return false;
    }
    client.ws.send(JSON.stringify(message));
    return true;
  }

  function sendError(client, code) {
    send(client, { type: 'error', code });
  }

  function sendChanges(client, records) {
    if (!records.length) return;
    const ordered = [...records].sort((a, b) => a.revision - b.revision);
    send(client, {
      type: 'changes',
      records: ordered,
      nextRevision: ordered[ordered.length - 1].revision,
      serverTime: now(),
    });
  }

  const unsubscribe = options.onChanges((accountId, changes) => {
    if (closed) return;
    for (const client of clients) {
      if (!client.ready || client.accountId !== accountId) continue;
      if (client.resuming) client.buffer.push(...changes);
      else sendChanges(client, changes);
    }
  });

  async function authenticate(client, message) {
    if (client.ready) return closeClient(client, 1008, 'already_authenticated');
    const token = String(message.token || '');
    const deviceId = String(message.deviceId || '').slice(0, 80);
    if (!token || !deviceId) return closeClient(client, 1008, 'bad_token');
    try {
      const { accountId } = await options.authorize(token, deviceId);
      let accountCount = 0;
      let deviceCount = 0;
      for (const other of clients) {
        if (!other.ready || other.ws.readyState !== WebSocket.OPEN) continue;
        if (other.accountId === accountId) accountCount++;
        if (other.accountId === accountId && other.deviceId === deviceId) deviceCount++;
      }
      if (deviceCount >= MAX_DEVICE_CONNECTIONS) return closeClient(client, 1008, 'too_many_devices');
      if (accountCount >= MAX_ACCOUNT_CONNECTIONS) return closeClient(client, 1008, 'too_many_accounts');
      client.accountId = accountId;
      client.deviceId = deviceId;
      client.ready = true;
      clearTimeout(client.authTimer);
      Promise.resolve(options.seen(accountId, deviceId, now())).catch(() => {});
      send(client, { type: 'ready', serverTime: now() });
    } catch (error) {
      closeClient(client, 1008, errorCode(error, 'bad_token').slice(0, 100));
    }
  }

  async function resume(client, message) {
    if (client.resuming) return sendError(client, 'resume_pending');
    const since = cursor(message.since);
    client.resuming = true;
    client.buffer = [];
    try {
      const records = await options.pull(client.accountId, since, 500);
      if (client.ws.readyState !== WebSocket.OPEN) return;
      let nextRevision = since;
      for (const record of records) if (record.revision > nextRevision) nextRevision = record.revision;
      if (!send(client, { type: 'changes', records, nextRevision, serverTime: now() })) return;
      const byRevision = new Map();
      for (const record of client.buffer) {
        if (record.revision > nextRevision && !byRevision.has(record.revision)) byRevision.set(record.revision, record);
      }
      const pending = [...byRevision.values()].sort((a, b) => a.revision - b.revision);
      client.resuming = false;
      client.buffer = [];
      sendChanges(client, pending);
    } catch (error) {
      if (client.ws.readyState === WebSocket.OPEN) {
        sendError(client, 'resume_failed');
        closeClient(client, 1011, 'resume_failed');
      }
    }
  }

  async function mutations(client, message) {
    const parsed = parseSyncV2Body({ since: 0, records: message.records });
    if (parsed.error) return sendError(client, parsed.error);
    try {
      const ack = await options.mutate(client.accountId, client.deviceId, parsed.records, now());
      send(client, { type: 'ack', ack, serverTime: now() });
    } catch (error) {
      sendError(client, errorCode(error, 'mutation_failed'));
    }
  }

  async function handleMessage(client, data, isBinary) {
    if (isBinary) {
      if (client.ready) sendError(client, 'bad_message');
      else closeClient(client, 1008, 'bad_message');
      return;
    }
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      if (client.ready) sendError(client, 'bad_message');
      else closeClient(client, 1008, 'bad_message');
      return;
    }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      if (client.ready) sendError(client, 'bad_message');
      else closeClient(client, 1008, 'bad_message');
      return;
    }
    if (message.type === 'auth') return authenticate(client, message);
    if (!client.ready) return closeClient(client, 1008, 'auth_required');
    if (message.type === 'resume') return resume(client, message);
    if (message.type === 'mutations') return mutations(client, message);
    if (message.type === 'ping') return send(client, { type: 'pong', serverTime: now() });
    sendError(client, 'bad_message');
  }

  wss.on('connection', (ws) => {
    const client = {
      ws,
      ready: false,
      accountId: '',
      deviceId: '',
      alive: true,
      resuming: false,
      buffer: [],
      queue: Promise.resolve(),
      authTimer: null,
    };
    clients.add(client);
    client.authTimer = setTimeout(() => closeClient(client, 1008, 'auth_timeout'), options.authTimeoutMs || 5000);
    if (client.authTimer.unref) client.authTimer.unref();
    ws.on('pong', () => { client.alive = true; });
    ws.on('message', (data, isBinary) => {
      client.queue = client.queue.then(() => handleMessage(client, data, isBinary)).catch(() => {
        if (client.ready) sendError(client, 'bad_message');
      });
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(client.authTimer);
      clients.delete(client);
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.ready || client.ws.readyState !== WebSocket.OPEN) continue;
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }, options.heartbeatMs || 25000);
  if (heartbeat.unref) heartbeat.unref();

  return {
    handleUpgrade(req, socket, head) {
      const path = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      if (path !== '/v2/sync/ws') return upgradeError(socket, 404, 'Not Found');
      if (closed) return upgradeError(socket, 503, 'Service Unavailable');
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      for (const client of clients) {
        clearTimeout(client.authTimer);
        client.ws.terminate();
      }
      clients.clear();
      wss.close();
    },
  };
}
