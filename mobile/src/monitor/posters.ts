// Wires subscription posters to the phone catalog and redraws «Подписки» when one arrives.
import { installSubPosters, lookupSubPoster } from '../../../src/monitor/subPoster';
import { reloadMonitor } from './ui';

let on = false;

/** Once per app launch: look up posters that were not known when the subscription was added. */
export function installPhoneSubPosters(): void {
  if (on) return;
  on = true;
  installSubPosters(lookupSubPoster, reloadMonitor);
}
