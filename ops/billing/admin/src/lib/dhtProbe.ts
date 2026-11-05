/** Admin probe result. `reason` is a fixed code from the server, not a torrent hash. */
export type DhtProbeResult = {
  auth?: boolean;
  ok?: boolean;
  status?: number;
  peers?: number;
  ms?: number;
  error?: string;
  reason?: string;
};

/** What the DHT tab says after «Проверить DHT». Button limit and sidecar busy are different 429s. */
export function probeText(row: DhtProbeResult) {
  if (row.auth === false) return 'Нужен вход';
  const ms = row.ms || 0;
  if (row.reason === 'probe_rate') return 'лимит проверки - это лимит кнопки, не сбой DHT';
  if (row.reason === 'sidecar_rate') return 'sidecar занят (429) - это лимит sidecar, не лимит кнопки';
  if (row.ok || row.reason === 'ok') return 'ок, пиров ' + (row.peers || 0) + ', ' + ms + ' мс';
  if (row.reason === 'not_ready') return 'проверка: DHT еще не поднялся (' + ms + ' мс)';
  if (row.reason === 'disabled') return 'проверка: sidecar выключен (' + ms + ' мс)';
  if (row.reason === 'down') return 'проверка: sidecar не ответил (' + ms + ' мс)';
  // Older replies had no reason: HTTP 429 from this button was the press limit.
  if (row.error === 'rate' || row.status === 429) return 'лимит проверки - это лимит кнопки, не сбой DHT';
  if (row.status === 503) return 'проверка: sidecar выключен (' + ms + ' мс)';
  return 'проверка не прошла (' + (row.status || 0) + ', ' + ms + ' мс)';
}
