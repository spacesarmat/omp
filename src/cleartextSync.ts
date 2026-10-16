import { effect } from '@preact/signals';
import { servers } from './store/servers';
import { flareSolverrUrl, onFlareChange } from './sources/flareStore';
import { indexerConnections, onIndexersChange } from './sources/indexerStore';
import { cleartextHosts, guardFetch, withTyped } from '../mobile/src/cleartextHosts';

/** Saved servers, FlareSolverr and indexers, plus [extra] (phone TVs). */
export function configuredCleartextUrls(extra: string[] = []): string[] {
  const urls = extra.slice();
  for (const s of servers.value) urls.push(s.url);
  const flare = flareSolverrUrl();
  if (flare) urls.push(flare);
  for (const c of indexerConnections()) urls.push(c.url);
  return urls;
}

/**
 * Pushes the saved cleartext hosts into the native policy and makes public `http://` wait for that push.
 * [extra] is read inside the effect (phone TV addresses). One call per page.
 */
export function installCleartextSync(push: (hosts: string[]) => Promise<void> | void, extra: () => string[] = () => []): void {
  const hosts = () => cleartextHosts(withTyped(configuredCleartextUrls(extra())));
  const sync = () => {
    void Promise.resolve(push(hosts())).catch(() => {});
  };
  effect(() => {
    extra();
    void servers.value;
    sync();
  });
  onIndexersChange(sync);
  onFlareChange(sync);
  sync();
  const orig = window.fetch.bind(window);
  window.fetch = guardFetch(orig, () => Promise.resolve(push(hosts())).then(() => undefined));
}
