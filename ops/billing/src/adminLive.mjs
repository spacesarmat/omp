/** In-process Server-Sent Events for the admin panel. One hub per process. */

const clients = new Set();

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
  connection: 'keep-alive',
};

/** One SSE message. Comment lines are heartbeats and carry no event. */
export function sseChunk(event) {
  return 'data: ' + JSON.stringify(event) + '\n\n';
}

export function sseHeartbeat() {
  return ': ping\n\n';
}

export function publishAdmin(event) {
  const chunk = sseChunk({ at: Date.now(), ...(event || {}), type: (event && event.type) || 'desk' });
  for (const write of clients) {
    try {
      write(chunk);
    } catch {
      clients.delete(write);
    }
  }
}

export function subscribeAdmin(write) {
  clients.add(write);
  return () => clients.delete(write);
}

export function adminLiveCount() {
  return clients.size;
}

export function resetAdminLive() {
  clients.clear();
}
