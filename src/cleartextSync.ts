import { effect } from '@preact/signals';
import { servers } from './store/servers';
import { flareSolverrUrl, onFlareChange } from './sources/flareStore';
import { indexerConnections, onIndexersChange } from './sources/indexerStore';
import { allowTypedHost, cleartextHosts, guardFetch, withTyped } from '../mobile/src/cleartextHosts';

/** Saved servers, FlareSolverr and indexers, plus [extra] (phone TVs). */
export function configuredCleartextUrls(extra: string[] = []): string[] {
  const urls = extra.slice();
  for (const s of servers.value) urls.push(s.url);
  const flare = flareSolverrUrl();
  if (flare) urls.push(flare);
  for (const c of indexerConnections()) urls.push(c.url);
  return urls;
}

/** The page's push, set by [installCleartextSync]. Native HTTP does not go through `window.fetch`. */
let flushCleartext: (() => Promise<void>) | null = null;

/**
 * Remember a host the user just typed and push it before a native HTTP check.
 * A LAN address clears the typed host. No-op until [installCleartextSync].
 */
export function allowTypedCleartext(url: string): Promise<void> {
  allowTypedHost(url);
  const run = flushCleartext;
  return run ? Promise.resolve().then(run) : Promise.resolve();
}

/**
 * Pushes the saved cleartext hosts into the native policy and makes public `http://` wait for that push.
 * [extra] is read inside the effect (phone TV addresses). One call per page. The return value removes that registration.
 */
export function installCleartextSync(push: (hosts: string[]) => Promise<void> | void, extra: () => string[] = () => []): () => void {
  const hosts = () => cleartextHosts(withTyped(configuredCleartextUrls(extra())));
  const flush = () => Promise.resolve(push(hosts())).then(() => undefined);
  flushCleartext = flush;
  const sync = () => {
    void flush().catch(() => {});
  };
  const stopServers = effect(() => {
    extra();
    void servers.value;
    sync();
  });
  const stopIndexers = onIndexersChange(sync);
  const stopFlare = onFlareChange(sync);
  sync();
  const orig = window.fetch.bind(window);
  window.fetch = guardFetch(orig, flush);
  return () => {
    stopServers();
    stopIndexers();
    stopFlare();
    if (flushCleartext === flush) flushCleartext = null;
    window.fetch = orig;
  };
}
