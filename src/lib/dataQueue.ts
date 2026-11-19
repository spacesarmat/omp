// One chain of writes per torrent. A later write waits for the earlier one, and a failure does not
// stop the chain. Chromium 53: no ?., no ??.

const chains: { [hash: string]: Promise<void> } = {};

/** Runs `job` after the pending writes of this torrent. Rejects when `job` rejects; the chain still continues. */
export function enqueueTorrentWrite<T>(hash: string, job: () => Promise<T>): Promise<T> {
  const key = (hash || '').toLowerCase();
  const prev = chains[key] || Promise.resolve();
  const run = prev.then(job, job);
  chains[key] = run.then(
    () => undefined,
    () => undefined,
  );
  const mine = chains[key];
  mine.then(() => {
    if (chains[key] === mine) delete chains[key];
  });
  return run;
}

/** Resolves when this torrent has no write still queued. Never rejects. */
export function torrentWriteSettled(hash: string): Promise<void> {
  const key = (hash || '').toLowerCase();
  return (chains[key] || Promise.resolve()).then(
    () => undefined,
    () => undefined,
  );
}

/** Tests: drop every pending chain. */
export function resetTorrentWrites(): void {
  Object.keys(chains).forEach((k) => delete chains[k]);
}
