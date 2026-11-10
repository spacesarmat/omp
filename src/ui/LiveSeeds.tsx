// A search row asks for live seeds only while it is on screen. The list order does not follow the new numbers.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import { settings } from '../store/settings';
import { infohashOf, phoneSeedBits, seedDisplay, trackerTargets, tvSeedLabel, type SeedDisplay } from '../sources/liveSeeds';
import { seedStatusLine, seedSuffix } from '../sources/seedRank';
import { SeedCheck } from './SeedCheck';
import { liveSeeds } from '../sources/liveSeedsRun';
import type { SourceResult } from '../sources/types';

function underTest(): boolean {
  try {
    return !!(import.meta as { env?: { VITEST?: boolean } }).env?.VITEST;
  } catch (e) {
    return false;
  }
}

/**
 * Binds the row element and reads the cached scrape for its infohash.
 * `active` false (a search round) does not scrape and does not read the cache: those requests share the manual-check queue.
 */
export function useSeedRow(r: SourceResult, active?: boolean): { bind: (el: HTMLElement | null) => void; view: SeedDisplay } {
  const enabled = settings.value.liveSeeds !== false && active !== false;
  const hash = infohashOf(r);
  const magnet = r.Magnet || '';
  const [, setTick] = useState(0);
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled || !hash) return;
    return liveSeeds().subscribe(hash, () => setTick((n) => n + 1));
  }, [enabled, hash]);

  useEffect(() => {
    if (!node || !enabled || !hash || underTest()) return;
    const targets = trackerTargets(magnet, hash);
    if (!targets.length) return;
    let stop = () => {};
    let seen = false;
    const arm = (on: boolean) => {
      if (on && !seen) {
        seen = true;
        stop = liveSeeds().watch({ hash: hash, trackers: targets, seed: r.Seed || 0, peer: r.Peer || 0 });
      } else if (!on && seen) {
        seen = false;
        stop();
        stop = () => {};
      }
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        let on = false;
        for (let i = 0; i < entries.length; i++) if (entries[i].isIntersecting) on = true;
        arm(on);
      });
      io.observe(node);
    } else {
      arm(true);
    }
    return () => {
      if (io) io.disconnect();
      if (seen) stop();
    };
  }, [node, enabled, hash, magnet, r.Seed, r.Peer]);

  const bind = (el: HTMLElement | null) => {
    setNode((cur) => (cur === el ? cur : el));
  };
  const entry = hash && enabled ? liveSeeds().get(hash) : null;
  return { bind: bind, view: seedDisplay({ Seed: r.Seed, Peer: r.Peer }, enabled, entry) };
}

/** TV search / news size line. Search passes `round`: tracker numbers first, then one checked status. */
export function TvSearchSize(p: { r: SourceResult; size: string; seedCode?: string; round?: boolean }) {
  const live = useSeedRow(p.r, !p.round);
  const marked = seedStatusLine(p.r);
  let label = '';
  let mode = 'search';
  if (marked) {
    label = marked;
    mode = p.r.seedCheck === 'live' ? 'live' : 'search';
  } else if (p.round) {
    label = tvSeedLabel({ mode: 'search', seeders: p.r.Seed || 0, leechers: p.r.Peer || 0 });
  } else {
    const view = live.view;
    mode = view.mode;
    const suffix = view.mode === 'live' ? '' : seedSuffix(p.r);
    const base = tvSeedLabel(view);
    label = suffix ? (base ? base + ' · ' + suffix : suffix) : base;
  }
  const hash = infohashOf(p.r) || 'row';
  return (
    <div class="search-size" ref={live.bind} data-seeds={mode}>
      {p.size ? p.size + (label ? ' · ' : '') : ''}
      {label ? <SeedCheck r={p.r} fallback={label} tv testCode={p.seedCode || ''} focusKey={'seed-' + hash} live={mode === 'live'} /> : null}
      {!label && mode === 'live' ? <span class="seed-live" aria-label={t('settings.liveSeedsLive')} /> : null}
    </div>
  );
}

export { phoneSeedBits };
