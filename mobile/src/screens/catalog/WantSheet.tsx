// «Хочу посмотреть»: a monitoring subscription for a title of the catalog (the query is the one of «Найти раздачи»).
import { useState } from 'preact/hooks';
import { Sheet } from '../../ui/Sheet';
import { showToast } from '../../ui/toast';
import { loadSearchFilters } from '../../ui/FiltersSheet';
import { askNotifyOnce, reloadMonitor } from '../../monitor/ui';
import { t } from '../../../../src/i18n';
import { addSubscription, loadSubs } from '../../../../src/monitor/subs';
import { subQualityOf } from '../../../../src/sources/filters';
import type { SubQuality } from '../../../../src/monitor/types';
import { torrentQuery, type CatalogCard } from '../../../../src/catalog/tmdb';

/** The quality this sheet offers: any, 1080p or 4K (720p of the filters counts as 1080p). */
function defaultQuality(): SubQuality {
  const q = subQualityOf(loadSearchFilters());
  return q === '' ? '' : q === '2160' ? '2160' : '1080';
}

export function WantSheet({ card, onClose }: { card: CatalogCard; onClose: () => void }) {
  const [quality, setQuality] = useState<SubQuality>(defaultQuality);
  // «Только лучшее качество»: on here, since a title is wanted once, in the best quality that comes out
  const [better, setBetter] = useState(true);
  const options: { id: SubQuality; label: string }[] = [
    { id: '', label: t('monitor.anyQuality') },
    { id: '1080', label: '1080p' },
    { id: '2160', label: '4K' },
  ];

  const subscribe = () => {
    const first = loadSubs().length === 0;
    const saved = addSubscription({ query: torrentQuery(card), quality, sources: null, notify: true, better });
    if (saved) {
      if (first) void askNotifyOnce().catch(() => {});
      reloadMonitor();
      showToast(t('titleCard.wantDone'));
    }
    onClose();
  };

  // a title without a year reads «"X"», not «"X" ()»
  const about = t(card.kind === 'tv' ? 'titleCard.wantSeries' : 'titleCard.wantFilm', { title: card.title, year: card.year || '' }).replace(' ()', '');

  return (
    <Sheet label={t('titleCard.want')} onClose={onClose}>
      <div class="m-sheet-title">{t('titleCard.want')}</div>
      <p class="m-want-text">{about}</p>
      <div class="m-muted m-small">{t('monitor.sub.quality')}</div>
      <div class="m-chips">
        {options.map((o) => (
          <button key={o.id} type="button" class={'m-chip' + (quality === o.id ? ' on' : '')} aria-pressed={quality === o.id} onClick={() => setQuality(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      <div class="m-skip-row">
        <span class="m-skip-text">
          {t('monitor.sub.better')}
          <span class="m-muted m-small">{t('monitor.sub.betterHint')}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={better}
          aria-label={t('monitor.sub.better')}
          class={'m-switch' + (better ? ' on' : '')}
          onClick={() => setBetter(!better)}
        >
          <span class="m-switch-knob" />
        </button>
      </div>
      <button type="button" class="m-btn m-btn-primary" onClick={subscribe}>
        {t('add.subscribe')}
      </button>
      <button type="button" class="m-btn m-btn-secondary" onClick={onClose}>
        {t('common.cancel')}
      </button>
    </Sheet>
  );
}
