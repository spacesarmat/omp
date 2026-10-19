// The phone's side of the catalog ads: the config signal (src/ads/ads.ts) refreshed from the billing server, and the
// event sender. Nothing is fetched until a catalog screen asks (useAdSlots); a failure keeps the last answer until it
// is an hour old, then there are no ads.
import { signal } from '@preact/signals';
import { billingGet, billingPost } from '../../../src/billing/client';
import { adsConfigStale, cachedAdsConfig, saveAdsConfig, type AdsConfig } from '../../../src/ads/ads';
import { flushAdEvents, setAdEventSender } from '../../../src/ads/events';
import { phoneSourceContext } from '../searchContext';

export const adsConfig = signal<AdsConfig>(cachedAdsConfig());

let inflight: Promise<void> | null = null;

export interface AdsIo {
  get(): Promise<{ status: number; text: string }>;
  post(form: { events: string }): Promise<unknown>;
}

const realIo: AdsIo = {
  get: () => billingGet(phoneSourceContext(), '/v1/ads-config', { timeoutMs: 10000 }),
  post: (form) => billingPost(phoneSourceContext(), '/v1/ads/event', form, { timeoutMs: 10000 }),
};
let io: AdsIo = realIo;

/** Tests and the dev harness: replace the network (no argument: the real one). */
export function setAdsIo(next?: AdsIo | null): void {
  io = next || realIo;
  setAdEventSender((form) => io.post(form));
}
setAdEventSender((form) => io.post(form));

/** The cached config into the signal, no network (an expired one reads as no ads). */
export function syncAdsFromCache(): void {
  adsConfig.value = cachedAdsConfig();
}

/** Fetches the config when the cached one is older than 5 minutes (never rejects). */
export function refreshAds(force?: boolean): Promise<void> {
  if (!force && !adsConfigStale()) {
    adsConfig.value = cachedAdsConfig();
    return Promise.resolve();
  }
  if (inflight) return inflight;
  const run = io.get().then(
    (res) => {
      if (res.status === 200) {
        try {
          saveAdsConfig(JSON.parse(res.text));
        } catch (e) {
          // a broken answer: the old one stays until it is too old
        }
      }
      adsConfig.value = cachedAdsConfig();
    },
    () => {
      adsConfig.value = cachedAdsConfig();
    },
  );
  inflight = run;
  run.then(() => {
    inflight = null;
  });
  return run;
}

// the batch goes out when the app is put away (the WebView may be frozen after that)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAdEvents();
  });
}
