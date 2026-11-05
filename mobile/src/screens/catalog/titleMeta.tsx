import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../../src/i18n';
import type { CatalogCard, Season } from '../../../../src/catalog/tmdb';

function startYear(card: CatalogCard): number {
  return card.firstAirDate && card.firstAirDate.length >= 4 ? +card.firstAirDate.slice(0, 4) : card.year;
}

function stillAiring(card: CatalogCard): boolean {
  return card.airing || card.status === 'returning' || card.status === 'production' || card.status === 'planned';
}

/** «2019 - 2024», or «2019 - выходит» while the series is on air. */
export function seriesDates(card: CatalogCard): string {
  const start = startYear(card);
  if (stillAiring(card)) return start ? start + ' - ' + t('titleCard.stillAiring') : t('titleCard.stillAiring');
  const last = card.lastAirDate && card.lastAirDate.length >= 4 ? +card.lastAirDate.slice(0, 4) : 0;
  const end = last || card.seasons.reduce((m, s) => Math.max(m, s.year), 0);
  if (!start) return end ? String(end) : '';
  return end > start ? start + ' - ' + end : String(start);
}

/** The short status next to the dates: «Выходит», «Завершён», … */
export function seriesStatusWord(card: CatalogCard): string {
  const s = card.status || '';
  if (s === 'ended') return t('series.statusEnded');
  if (s === 'canceled') return t('series.statusCanceled');
  if (s === 'production' || s === 'planned') return t('series.statusProduction');
  if (s === 'returning' || card.airing) return t('series.statusAiring');
  return '';
}

export function Overview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  // «Ещё» only when the text does not fit in its 4 lines
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && !open) setClamped(node.scrollHeight > node.clientHeight + 1);
  }, [text, open]);
  return (
    <div class="m-tc-about">
      <p ref={ref} class={'m-tc-overview' + (open ? ' open' : '')}>
        {text}
      </p>
      {(clamped || open) && (
        <button type="button" class="m-btn-text m-tc-more" onClick={() => setOpen(!open)}>
          {open ? t('now.collapse') : t('titleCard.more')}
        </button>
      )}
    </div>
  );
}
