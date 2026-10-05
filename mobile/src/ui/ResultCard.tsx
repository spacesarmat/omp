import type { ComponentChildren } from 'preact';
import { addCategoryLabel } from '../../../src/lib/categoryGuess';
import { resultDate, seedsText, sourceBadge, sourceName } from '../../../src/sources/view';
import type { SourceResult } from '../../../src/sources/types';
import type { RowBusy } from '../addResult';
import { t } from '../../../src/i18n';
import { RawTitle, ReleaseChips, ReleaseName, ResultThumb, hasRawLine } from './ReleaseRow';

/** «18 GB · 152 сида · сегодня · ещё в Torznab». */
export function resultMeta(r: SourceResult): string {
  const more = r.sources && r.sources.length ? t('add.alsoIn', { names: r.sources.map(sourceName).join(', ') }) : '';
  return [r.Size, seedsText(r.Seed || 0), resultDate(r), more].filter(Boolean).join(' · ');
}

/**
 * A found release: the poster, the short title and its meta, quality chips, the full tracker title, badge,
 * size · seeds · date, the category ▾, «Добавить» and «На ТВ».
 */
export function ResultCard(p: {
  r: SourceResult;
  category: string;
  busy?: RowBusy;
  /** A label before the source badge, e.g. «Новая». */
  flag?: string;
  highlight?: boolean;
  onCategory: () => void;
  onAdd: () => void;
  onWatch: () => void;
  children?: ComponentChildren;
}) {
  const { r } = p;
  const label = addCategoryLabel(p.category);
  return (
    <div class={'m-result m-result-card' + (p.highlight ? ' m-hl' : '')} data-title={r.Title} data-highlight={p.highlight ? '' : undefined}>
      <div class="m-rel-top">
        <ResultThumb title={r.Title} />
        <div class="m-rel-text">
          <ReleaseName raw={r.Title} />
          <ReleaseChips raw={r.Title} />
          {hasRawLine(r.Title) && <RawTitle raw={r.Title} />}
          <div class="m-result-meta m-small">
            {p.flag && <span class="m-flag">{p.flag}</span>}
            <span class="m-src-badge">{sourceBadge(r)}</span>
            <span class="m-muted">{resultMeta(r)}</span>
          </div>
        </div>
      </div>
      {p.busy === 'link' && (
        <div class="m-muted m-small" role="status">
          {t('add.gettingLink')}
        </div>
      )}
      {p.children}
      <div class="m-result-actions">
        <button type="button" class="m-chip" aria-label={t('add.categoryOf', { label, title: r.Title })} onClick={p.onCategory}>
          {label + ' ▾'}
        </button>
        <span class="m-grow" />
        <button
          type="button"
          class="m-btn m-btn-secondary m-btn-sm"
          aria-label={t('add.addToServer', { title: r.Title })}
          disabled={!!p.busy}
          onClick={p.onAdd}
        >
          {t('common.add')}
        </button>
        <button
          type="button"
          class="m-btn m-btn-primary m-btn-sm"
          aria-label={t('add.addAndWatch', { title: r.Title })}
          disabled={!!p.busy}
          onClick={p.onWatch}
        >
          {t('add.onTv')}
        </button>
      </div>
    </div>
  );
}
