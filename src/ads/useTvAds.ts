// Where the TV ad cells of one list go. A position is drawn only when its image is loaded and the card it goes
// before is below the screen, so a banner never pushes what is already on screen. Same rules as the phone hook.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { adPositions, adsFor, pickBanner, type AdBanner, type AdSection } from './ads';
import { adEvent } from './events';
import { APP_VERSION } from '../version';
import { ACCESS_KEY, ompSubscribed } from '../billing/entitlement';
import { onBillingChange, SESSION_KEY } from '../billing/session';
import { ensureFirstRun } from './firstRun';
import { phoneLink, setPhoneSubscribed } from '../phone/phoneStore';
import { phoneRpc } from '../phone/rpc';
import { adPlatform, installTvAds, refreshTvAds, syncTvAdsFromCache, tvAdsConfig } from './tvAds';

const REFRESH_MS = 5 * 60 * 1000;
const FIRST_FETCH_MS = 2000;
const loaded = new Set<string>();
const loading = new Map<string, Promise<boolean>>();

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
export function markTvAdImagesLoaded(urls: string[]): void {
  for (let i = 0; i < urls.length; i++) loaded.add(urls[i]);
}

export interface TvAdSlots {
  admitted: number[];
  banner(pos: number): AdBanner | null;
  shown(pos: number): void;
  /** Records a click. The cell opens the QR itself when the banner's tvMode is qr. */
  click(pos: number): void;
}

export interface TvAdSlotOptions {
  section: AdSection;
  count: number;
  perScreen: number;
  /** False in History, search, the want list, an empty or failed list. */
  active: boolean;
  listKey: string;
  itemEl: (i: number) => Element | null;
}

/** About how many cards one TV screen holds (the spacing of «at most one ad per screen»). */
export const TV_PER_SCREEN = { large: 12, small: 18, list: 7, compact: 14, disc: 16 };

export function useTvAds(o: TvAdSlotOptions): TvAdSlots {
  installTvAds();
  const cfg = tvAdsConfig.value;
  const link = phoneLink.value;
  const platform = adPlatform();
  const [adm, setAdm] = useState<{ key: string; list: number[] }>({ key: o.listKey, list: [] });
  const [imgTick, setImgTick] = useState(0);
  const seen = useRef(new Set<string>());
  const key = useRef(o.listKey);
  const opts = useRef(o);
  opts.current = o;
  const held = useRef<{ [pos: number]: AdBanner }>({});
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const [subscribed, setSubscribed] = useState(() => ompSubscribed());

  useEffect(() => {
    syncTvAdsFromCache();
    const hideLinked = () => cfgRef.current.tvHideIfLinkedSubscriber && phoneLink.peek() && phoneLink.peek()!.sub === true;
    const syncSub = () => setSubscribed(ompSubscribed());
    const tick = () => {
      // An expiry while the screen stays open has no billing event. The timer is what notices it.
      syncSub();
      if (ompSubscribed() || hideLinked()) return;
      void refreshTvAds();
    };
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

  // A linked phone tells the TV whether it is subscribed (launch param first, then this).
  useEffect(() => {
    if (!link) return;
    let alive = true;
    const ask = () => {
      phoneRpc<{ subscribed?: boolean }>('ompSubscribed').then(
        (r) => {
          if (alive && r && typeof r.subscribed === 'boolean') setPhoneSubscribed(r.subscribed);
        },
        () => undefined,
      );
    };
    ask();
    const id = setInterval(ask, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [link ? link.url : '']);

  const now = Date.now();
  const day = Math.floor(now / 86400000);
  const linked = !!(link && link.sub);
  const banners = useMemo(
    () =>
      o.active
        ? adsFor(cfg, {
            platform,
            section: o.section,
            appVersion: APP_VERSION,
            subscribed,
            linkedSubscriber: linked,
            firstRun: ensureFirstRun(now),
            now,
          })
        : [],
    [cfg, o.active, o.section, day, subscribed, linked, platform],
  );
  const positions = useMemo(() => {
    if (!banners.length) return [];
    return adPositions(o.count, cfg, o.perScreen);
  }, [banners, o.count, o.perScreen, cfg]);
  const pickAt = (pos: number) => pickBanner(banners, o.section + ':' + platform + ':' + pos, now);
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

  if (key.current !== o.listKey) {
    key.current = o.listKey;
    seen.current = new Set();
    held.current = {};
  }
  if (!banners.length) held.current = {};
  const admitted = adm.key === o.listKey && banners.length ? adm.list : [];
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
      adEvent(b.id, o.section, platform, 'i');
    },
    click(pos) {
      const b = bannerAt(pos);
      if (!b) return;
      adEvent(b.id, o.section, platform, 'c');
    },
  };
}
