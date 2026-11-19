// A card-sized hole for a Yandex native ad. The SDK draws the ad, the «Реклама» label and the advertiser in a
// native view aligned to this element. The web layer keeps the same size as the cards around it.
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../../src/i18n';
import type { AdCellKind } from './AdCell';
import { concealYandexSlot, hideYandexSlot, placeYandexSlot, yandexClip } from './yandexNative';

const SHOWN_MS = 1000;

export function YandexCell({ kind, slotId, onShown }: { kind: AdCellKind; slotId: string; onShown: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const cb = useRef(onShown);
  cb.current = onShown;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const clip = yandexClip();
      const r = el.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth || r.width;
      const y = Math.max(r.top, clip.top);
      const height = Math.min(r.bottom, clip.bottom) - y;
      // A sheet, the sticky header or the tab bar must stay above the native ad.
      if (clip.blocked || height < 8 || r.width < 8) {
        concealYandexSlot(slotId);
        return;
      }
      placeYandexSlot(slotId, { x: r.left, y, width: r.width, height, viewportWidth });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    const how = { passive: true, capture: true };
    window.addEventListener('scroll', onScroll, how);
    window.addEventListener('resize', onScroll);
    // Sheets are added to the page without a scroll. One observer per visible ad is enough.
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onScroll);
    if (mo) mo.observe(document.body, { childList: true, subtree: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll);
    if (ro) ro.observe(el);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, how);
      window.removeEventListener('resize', onScroll);
      if (mo) mo.disconnect();
      if (ro) ro.disconnect();
      hideYandexSlot(slotId);
    };
  }, [slotId, kind]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5);
        if (visible && timer === undefined) {
          timer = setTimeout(() => {
            timer = undefined;
            cb.current();
          }, SHOWN_MS);
        } else if (!visible && timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [slotId]);

  const label = t('ads.label');
  const badge = <span class="m-ad-badge">{label}</span>;
  if (kind === 'list') {
    return (
      <div class="m-row-wrap m-ad-wrap" data-yandex={slotId}>
        <div class="m-vrow m-ad m-yandex" aria-label={label} ref={ref as never}>
          <span class="m-poster-row m-ad-poster">{badge}</span>
          <span class="m-vrow-text">
            <span class="m-card-title">{label}</span>
          </span>
        </div>
      </div>
    );
  }
  if (kind === 'compact') {
    return (
      <div class="m-row-wrap m-ad-wrap" data-yandex={slotId}>
        <div class="m-crow m-ad m-yandex" aria-label={label} ref={ref as never}>
          <span class="m-crow-main">
            <span class="m-crow-title">{label}</span>
            <span class="m-crow-sub">
              <span class="m-ad-tag">{label}</span>
            </span>
          </span>
        </div>
      </div>
    );
  }
  if (kind === 'rail') {
    return (
      <section class="m-disc-rail m-ad-rail m-yandex" data-yandex={slotId} ref={ref as never} aria-label={label}>
        <h3 class="m-disc-rail-title">{label}</h3>
        <div class="m-ad-rail-row">
          <div class="m-disc-tile m-disc-rail-tile m-ad">
            <span class="m-disc-poster m-ad-poster">{badge}</span>
          </div>
        </div>
      </section>
    );
  }
  if (kind === 'disc') {
    return (
      <div class="m-disc-tile m-ad m-yandex" data-yandex={slotId} ref={ref as never} aria-label={label}>
        <span class="m-disc-poster m-ad-poster">{badge}</span>
        <span class="m-card-title m-disc-title">{label}</span>
      </div>
    );
  }
  return (
    <div class="m-card m-ad m-yandex" data-yandex={slotId} ref={ref as never} aria-label={label}>
      <span class="m-ad-poster m-ad-poster-lib">{badge}</span>
      <span class="m-card-title">{label}</span>
    </div>
  );
}
