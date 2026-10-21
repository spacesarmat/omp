// Where the ad cells of one list go, and which of them may be drawn now. A position is admitted only when its banner
// image is loaded and the card it goes before is below the screen: an ad never pushes visible content (no layout
// shift). Admitted positions stay until the list changes (tab, filter, query) or ads are switched off for it.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { adPositions, adsFor, pickBanner, railPositions, type AdBanner, type AdSection } from '../../../src/ads/ads';
import { adEvent } from '../../../src/ads/events';
import { APP_VERSION } from '../../../src/version';
import { ompSubscribed } from '../../../src/billing/entitlement';
import { onBillingChange } from '../../../src/billing/session';
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
  // localStorage, not a signal: a renewal (this page, or the background check) has to bump it or the open catalog
  // keeps the ads it already drew
  const [subscribed, setSubscribed] = useState(() => ompSubscribed());

  // the config is read while a catalog screen is open: the cached one now, the server's a moment later (not
  // competing with the catalog's own first requests) and then every 5 minutes. A subscriber never asks.
  // Subscription is re-read on a billing change and when the app comes back (the background page writes
  // localStorage in another context, so this page does not hear that save).
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
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      off();
      document.removeEventListener('visibilitychange', onVis);
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
  const bannerAt = (pos: number) => pickBanner(banners, o.section + ':' + pos, now);

  // another list, or ads off here: start over (the impressions too)
  if (key.current !== o.listKey) {
    key.current = o.listKey;
    seen.current = new Set();
  }
  const admitted = adm.key === o.listKey && banners.length ? adm.list : [];
  useEffect(() => {
    if (!banners.length && adm.list.length) setAdm({ key: o.listKey, list: [] });
  }, [banners.length]);

  // the images of the banners these positions would show
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    for (let i = 0; i < positions.length; i++) {
      const b = bannerAt(positions[i]);
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
        const b = bannerAt(p);
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

  const drawn = admitted.filter((p) => positions.indexOf(p) >= 0);
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
