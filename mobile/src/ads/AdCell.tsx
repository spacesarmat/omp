// The ad cell: the size of the cards around it in every view (Library grid 2 / 3 columns, list, compact; «Обзор» grid
// 2 / 3 / 4 columns; a block between the home rails). It carries the marking the law asks for: «Реклама», the
// advertiser and the erid. An impression is counted once the cell is half visible for a second.
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../../src/i18n';
import type { AdBanner } from '../../../src/ads/ads';

export type AdCellKind = 'grid' | 'list' | 'compact' | 'disc' | 'rail';

const SHOWN_MS = 1000;

function useShown(onShown: () => void) {
  const ref = useRef<HTMLElement>(null);
  const cb = useRef(onShown);
  cb.current = onShown;
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
  }, []);
  return ref;
}

function Badge() {
  return <span class="m-ad-badge">{t('ads.label')}</span>;
}

function Erid({ b }: { b: AdBanner }) {
  return <span class="m-ad-erid">{t('ads.erid', { erid: b.erid })}</span>;
}

export function AdCell({ kind, banner: b, onShown, onClick }: { kind: AdCellKind; banner: AdBanner; onShown: () => void; onClick: () => void }) {
  const ref = useShown(onShown);
  const aria = t('ads.aria', { title: b.title, advertiser: b.advertiser });
  const img = <img src={b.image} alt="" decoding="async" draggable={false} />;
  if (kind === 'list') {
    return (
      <div class="m-row-wrap m-ad-wrap" data-ad={b.id} ref={ref as never}>
        <button type="button" class="m-vrow m-ad" aria-label={aria} onClick={onClick}>
          <span class="m-poster-row m-ad-poster">{img}</span>
          <span class="m-vrow-text">
            <span class="m-card-title">{b.title}</span>
            {b.text && <span class="m-muted m-small m-ad-text">{b.text}</span>}
            <span class="m-muted m-small m-vrow-meta">
              <span class="m-ad-tag">{t('ads.label')}</span>
              <span class="m-ad-who">{b.advertiser}</span>
            </span>
            <Erid b={b} />
          </span>
        </button>
      </div>
    );
  }
  if (kind === 'compact') {
    return (
      <div class="m-row-wrap m-ad-wrap" data-ad={b.id} ref={ref as never}>
        <button type="button" class="m-crow m-ad" aria-label={aria} onClick={onClick}>
          <span class="m-crow-main">
            <span class="m-crow-title">{b.title}</span>
            <span class="m-crow-sub">
              <span class="m-ad-tag">{t('ads.label')}</span>
              <span class="m-muted m-small m-crow-meta">{b.advertiser + ' · ' + t('ads.erid', { erid: b.erid })}</span>
            </span>
          </span>
        </button>
      </div>
    );
  }
  if (kind === 'rail') {
    return (
      <section class="m-disc-rail m-ad-rail" data-ad={b.id} ref={ref as never} aria-label={aria}>
        <h3 class="m-disc-rail-title">{t('ads.label')}</h3>
        <div class="m-ad-rail-row">
          <button type="button" class="m-disc-tile m-disc-rail-tile m-ad" aria-label={aria} onClick={onClick}>
            <span class="m-disc-poster m-ad-poster">
              {img}
              <Badge />
            </span>
          </button>
          <div class="m-ad-rail-text">
            <span class="m-card-title">{b.title}</span>
            {b.text && <span class="m-muted m-small m-ad-text">{b.text}</span>}
            <span class="m-muted m-small m-ad-who">{b.advertiser}</span>
            <Erid b={b} />
            <button type="button" class="m-btn m-btn-secondary m-btn-sm m-ad-more" onClick={onClick}>
              {t('ads.open')}
            </button>
          </div>
        </div>
      </section>
    );
  }
  if (kind === 'disc') {
    return (
      <button type="button" class="m-disc-tile m-ad" data-ad={b.id} ref={ref as never} aria-label={aria} onClick={onClick}>
        <span class="m-disc-poster m-ad-poster">
          {img}
          <Badge />
        </span>
        <span class="m-card-title m-disc-title">{b.title}</span>
        <span class="m-muted m-small m-disc-meta m-ad-who">{b.advertiser}</span>
        <Erid b={b} />
      </button>
    );
  }
  return (
    <button type="button" class="m-card m-ad" data-ad={b.id} ref={ref as never} aria-label={aria} onClick={onClick}>
      <span class="m-ad-poster m-ad-poster-lib">
        {img}
        <Badge />
      </span>
      <span class="m-card-title">{b.title}</span>
      <span class="m-muted m-card-meta m-ad-who">{b.advertiser}</span>
      <Erid b={b} />
    </button>
  );
}
