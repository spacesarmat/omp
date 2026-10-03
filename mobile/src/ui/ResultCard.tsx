import type { ComponentChildren } from 'preact';
import { addCategoryLabel } from '../../../src/lib/categoryGuess';
import { resultDate, seedsText, sourceBadge, sourceName } from '../../../src/sources/view';
import type { SourceResult } from '../../../src/sources/types';
import type { RowBusy } from '../addResult';

/** «18 GB · 152 сида · сегодня · ещё в Torznab». */
export function resultMeta(r: SourceResult): string {
  const more = r.sources && r.sources.length ? 'ещё в ' + r.sources.map(sourceName).join(', ') : '';
  return [r.Size, seedsText(r.Seed || 0), resultDate(r), more].filter(Boolean).join(' · ');
}

/** A found release: badge, size · seeds · date, the category ▾, «Добавить» and «На ТВ». */
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
    <div class={'m-result m-result-card' + (p.highlight ? ' m-hl' : '')} data-highlight={p.highlight ? '' : undefined}>
      <div class="m-result-title">{r.Title}</div>
      <div class="m-result-meta m-small">
        {p.flag && <span class="m-flag">{p.flag}</span>}
        <span class="m-src-badge">{sourceBadge(r)}</span>
        <span class="m-muted">{resultMeta(r)}</span>
      </div>
      {p.busy === 'link' && (
        <div class="m-muted m-small" role="status">
          Получаю ссылку…
        </div>
      )}
      {p.children}
      <div class="m-result-actions">
        <button type="button" class="m-chip" aria-label={'Категория: ' + label + ', ' + r.Title} onClick={p.onCategory}>
          {label + ' ▾'}
        </button>
        <span class="m-grow" />
        <button
          type="button"
          class="m-btn m-btn-secondary m-btn-sm"
          aria-label={'Добавить на сервер: ' + r.Title}
          disabled={!!p.busy}
          onClick={p.onAdd}
        >
          Добавить
        </button>
        <button
          type="button"
          class="m-btn m-btn-primary m-btn-sm"
          aria-label={'Добавить и смотреть на ТВ: ' + r.Title}
          disabled={!!p.busy}
          onClick={p.onWatch}
        >
          На ТВ
        </button>
      </div>
    </div>
  );
}
