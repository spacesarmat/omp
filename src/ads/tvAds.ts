// The TV's side of the catalog ads: the same cached config as the phone (src/ads/ads.ts). Android TV uses the
// APK's native HTTP (no CORS: the page is http://localhost). webOS has no native HTTP, so it uses XHR; the public
// GET routes answer Access-Control-Allow-Origin: * with no credentials. Nothing is asked for a subscriber, or for
// a TV whose linked phone is subscribed.
import { signal } from '@preact/signals';
import { BILLING_ORIGIN } from '../billing/config';
import { billingGet, billingPost } from '../billing/client';
import { nativeSourceHttp } from '../platform/androidNative';
import { tvSourceContext } from '../sources/tvContext';
import { adsConfigStale, cachedAdsConfig, saveAdsConfig, type AdsConfig } from './ads';
import { flushAdEvents, setAdEventSender } from './events';
import { platformKind } from '../platform/env';
import type { AdPlatform } from './ads';

export const tvAdsConfig = signal<AdsConfig>(cachedAdsConfig());

export function adPlatform(): AdPlatform {
  return platformKind() === 'androidtv' ? 'androidTv' : 'webos';
}

export interface TvAdsIo {
  get(): Promise<{ status: number; text: string }>;
  post(form: { events: string }): Promise<unknown>;
}

function xhr(method: 'GET' | 'POST', url: string, body: string | null): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    x.timeout = 10000;
    if (body !== null) x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    x.onload = () => resolve({ status: x.status, text: x.responseText || '' });
    x.onerror = () => reject(new Error('network'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.send(body);
  });
}

const realIo: TvAdsIo = {
  get: () => {
    // Asked on each call: the plugin is missing on webOS and in tests, and may appear after the module loads.
    if (nativeSourceHttp()) return billingGet(tvSourceContext(), '/v1/ads-config', { timeoutMs: 10000 }).then((r) => ({ status: r.status, text: r.text }));
    return xhr('GET', BILLING_ORIGIN + '/v1/ads-config', null);
  },
  post: (form) => {
    if (nativeSourceHttp()) return billingPost(tvSourceContext(), '/v1/ads/event', form, { timeoutMs: 10000 }).then(() => undefined);
    return xhr('POST', BILLING_ORIGIN + '/v1/ads/event', 'events=' + encodeURIComponent(form.events)).then(() => undefined);
  },
};
let io: TvAdsIo = realIo;

/** Tests: replace the network (no argument: native HTTP on Android TV, XHR on webOS). */
export function setTvAdsIo(next?: TvAdsIo | null): void {
  io = next || realIo;
  setAdEventSender((form) => io.post(form));
}

export function syncTvAdsFromCache(): void {
  tvAdsConfig.value = cachedAdsConfig();
}

let inflight: Promise<void> | null = null;

/** Fetches the config when the cached one is stale (never rejects). */
export function refreshTvAds(force?: boolean): Promise<void> {
  if (!force && !adsConfigStale()) {
    tvAdsConfig.value = cachedAdsConfig();
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
      tvAdsConfig.value = cachedAdsConfig();
    },
    () => {
      tvAdsConfig.value = cachedAdsConfig();
    },
  );
  inflight = run;
  run.then(() => {
    inflight = null;
  });
  return run;
}

let installed = false;

/** Event sender and the flush when the app is hidden. Idempotent. */
export function installTvAds(): void {
  if (installed) return;
  installed = true;
  setAdEventSender((form) => io.post(form));
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAdEvents();
  });
}
