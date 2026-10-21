// Where the ad cells of one list go, and which of them may be drawn now. A position is admitted only when its banner
// image is loaded and the card it goes before is below the screen: an ad never pushes visible content (no layout
// shift). Admitted positions stay until the list changes (tab, filter, query) or ads are switched off for it.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { adPositions, adsFor, pickBanner, railPositions, type AdBanner, type AdSection } from '../../../src/ads/ads';
import { adEvent } from '../../../src/ads/events';
import { APP_VERSION } from '../../../src/version';
import { ACCESS_KEY, ompSubscribed } from '../../../src/billing/entitlement';
import { onBillingChange, SESSION_KEY } from '../../../src/billing/session';
import { ensureFirstRun } from '../donate';
import { adsConfig, refreshAds, syncAdsFromCache } from './phoneAds';

const REFRESH_MS = 5 * 60 * 1000;
const FIRST_FETCH_MS = 2000;
const loaded = new Set<string>();
const loading = new Map<string, Promise<boolean>>();

/** Loads a banner image once; true when it can be drawn without a jump. */
function preload(url: string): Promise<boolean> {
  if (loaded.has(url)) return Promise.resolve(true);
  const cur = loading.get(url);
  if (cur) return cur;
  const p = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => {
      loaded.add(url);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
  loading.set(url, p);
  p.then((ok) => {
    if (!ok) loading.delete(url);
  });
  return p;
}

/** Tests: images count as loaded. */
export function markAdImagesLoaded(urls: string[]): void {
  for (let i = 0; i < urls.length; i++) loaded.add(urls[i]);
}

export interface AdSlots {
  /** Positions with an ad drawn now (before the card / rail at that index). */
  admitted: number[];
  banner(pos: number): AdBanner | null;
  shown(pos: number): void;
  click(pos: number): void;
}

export interface AdSlotOptions {
  section: AdSection;
  /** Cards (or rails) in the list. */
  count: number;
  /** About how many cards one screen holds in this view (spacing for maxPerScreen). */
  perScreen: number;
  /** False in History, search, selection mode, an empty or failed list. */
  active: boolean;
  /** Changes when the list is another one (tab, filter, query): the admitted positions start over. */
  listKey: string;
  /** The element of the card (or rail) at an index, to see whether it is below the screen. */
  itemEl: (i: number) => Element | null;
}

const PLATFORM = 'phone' as const;

export function useAdSlots(o: AdSlotOptions): AdSlots {
  const cfg = adsConfig.value;
  const [adm, setAdm] = useState<{ key: string; list: number[] }>({ key: o.listKey, list: [] });
  const [imgTick, setImgTick] = useState(0);
  const seen = useRef(new Set<string>());
  const key = useRef(o.listKey);
  const opts = useRef(o);
  opts.current = o;
  // The banner actually drawn in an admitted slot. A refresh may pick another one before its image has loaded;
  // the cell keeps this one until then, so it never goes blank and the impression timer does not start early.
  // A banner that the refresh removed or that expired is not kept: a failed replacement image must not leave it up.
  const held = useRef<{ [pos: number]: AdBanner }>({});
  // localStorage, not a signal: a renewal (this page, or the background check) has to bump it or the open catalog
  // keeps the ads it already drew
  const [subscribed, setSubscribed] = useState(() => ompSubscribed());

  // the config is read while a catalog screen is open: the cached one now, the server's a moment later (not
  // competing with the catalog's own first requests) and then every 5 minutes. A subscriber never asks.
  // Subscription is re-read on a billing change, when the app comes back, and when the background page writes
  // the session or the cached /v1/me answer (another document: this page hears that as a storage event).
  useEffect(() => {
    syncAdsFromCache();
    const tick = () => {
      if (!ompSubscribed()) void refreshAds();
    };
    const syncSub = () => setSubscribed(ompSubscribed());
    const first = setTimeout(tick, FIRST_FETCH_MS);
    const id = setInterval(tick, REFRESH_MS);
    const off = onBillingChange(syncSub);
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      syncSub();
      tick();
    };
    const onStore = (e: StorageEvent) => {
      if (e.key !== null && e.key !== SESSION_KEY && e.key !== ACCESS_KEY) return;
      syncSub();
      tick();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('storage', onStore);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      off();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('storage', onStore);
    };
  }, []);

  const now = Date.now();
  const day = Math.floor(now / 86400000);
  const banners = useMemo(
    () =>
      o.active
        ? adsFor(cfg, { platform: PLATFORM, section: o.section, appVersion: APP_VERSION, subscribed, firstRun: ensureFirstRun(now), now })
        : [],
    [cfg, o.active, o.section, day, subscribed],
  );
  const positions = useMemo(() => {
    if (!banners.length) return [];
    return o.section === 'discoverRails' ? railPositions(o.count, cfg.railsEvery) : adPositions(o.count, cfg, o.perScreen);
  }, [banners, o.count, o.perScreen, o.section, cfg]);
  const pickAt = (pos: number) => pickBanner(banners, o.section + ':' + pos, now);
  // What the cell draws. The pick is used for preloading and for admitting a new slot. A slot that is already
  // on screen stays on its current banner until the replacement image is loaded, and only while that banner is
  // still eligible. Otherwise the cell is dropped at once, without waiting for the replacement. Its admission
  // goes with it, so the replacement is not drawn in that visible slot (that would push the cards).
  const bannerAt = (pos: number): AdBanner | null => {
    const next = pickAt(pos);
    if (!next) return null;
    if (loaded.has(next.image)) {
      held.current[pos] = next;
      return next;
    }
    const prev = held.current[pos];
    if (!prev) return null;
    for (let i = 0; i < banners.length; i++) {
      if (banners[i].id === prev.id) return prev;
    }
    delete held.current[pos];
    return null;
  };

  // another list, or ads off here: start over (the impressions too)
  if (key.current !== o.listKey) {
    key.current = o.listKey;
    seen.current = new Set();
    held.current = {};
  }
  if (!banners.length) held.current = {};
  const admitted = adm.key === o.listKey && banners.length ? adm.list : [];
  // Positions whose banner was withdrawn and whose replacement is not ready to draw. They leave `admitted`
  // so the next image, once loaded, has to pass the below-the-screen check again.
  const released: number[] = [];
  for (let i = 0; i < admitted.length; i++) {
    const p = admitted[i];
    if (positions.indexOf(p) < 0) continue;
    if (!bannerAt(p)) released.push(p);
  }
  useEffect(() => {
    if (!banners.length && adm.list.length) setAdm({ key: o.listKey, list: [] });
  }, [banners.length]);
  useEffect(() => {
    if (!released.length) return;
    const k = opts.current.listKey;
    setAdm((prev) => {
      if (prev.key !== k) return prev;
      const list = prev.list.filter((p) => released.indexOf(p) < 0);
      if (list.length === prev.list.length) return prev;
      return { key: k, list };
    });
  }, [released.join(',')]);

  // the images of the banners these positions would show
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    for (let i = 0; i < positions.length; i++) {
      const b = pickAt(positions[i]);
      if (b && urls.indexOf(b.image) < 0) urls.push(b.image);
    }
    for (let i = 0; i < urls.length; i++) {
      if (loaded.has(urls[i])) continue;
      void preload(urls[i]).then((ok) => {
        if (alive && ok) setImgTick((n) => n + 1);
      });
    }
    return () => {
      alive = false;
    };
  }, [positions.join(','), banners]);

  // admit the positions whose card is below the screen; again on scroll, resize and new images
  useEffect(() => {
    if (!positions.length) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const cur = opts.current;
      const bottom = window.innerHeight || document.documentElement.clientHeight || 0;
      const add: number[] = [];
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        if (admitted.indexOf(p) >= 0) continue;
        const b = pickAt(p);
        if (!b || !loaded.has(b.image)) continue;
        const el = cur.itemEl(p);
        if (!el) continue;
        if (el.getBoundingClientRect().top >= bottom) add.push(p);
      }
      if (!add.length) return;
      const k = cur.listKey;
      setAdm((prev) => {
        const base = prev.key === k ? prev.list : [];
        return { key: k, list: base.concat(add.filter((p) => base.indexOf(p) < 0)) };
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    // capture: the catalog lists scroll inside their own boxes, and a scroll event does not bubble
    const how = { passive: true, capture: true };
    window.addEventListener('scroll', onScroll, how);
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, how);
      window.removeEventListener('resize', onScroll);
    };
  }, [positions.join(','), admitted.join(','), imgTick, banners]);

  const drawn = admitted.filter((p) => positions.indexOf(p) >= 0 && released.indexOf(p) < 0);
  return {
    admitted: drawn,
    banner: bannerAt,
    shown(pos) {
      const b = bannerAt(pos);
      if (!b) return;
      const k = pos + ':' + b.id;
      if (seen.current.has(k)) return;
      seen.current.add(k);
      adEvent(b.id, o.section, PLATFORM, 'i');
    },
    click(pos) {
      const b = bannerAt(pos);
      if (!b) return;
      adEvent(b.id, o.section, PLATFORM, 'c');
      window.open(b.url, '_system');
    },
  };
}

/** About how many cards one phone screen holds per view (the spacing of «at most one ad per screen»). */
export const PER_SCREEN = { large: 6, small: 12, list: 8, compact: 12, cols2: 6, cols3: 12, cols4: 20 };
