import { useState } from 'preact/hooks';
import { addCategories } from '../../../src/lib/categoryGuess';
import { resultDate, seedsText, sourceBadge, sourceName } from '../../../src/sources/view';
import type { SourceResult } from '../../../src/sources/types';
import type { RowBusy } from '../addResult';
import { fmtSize, t } from '../../../src/i18n';
import { parseSize } from '../../../src/sources/html';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { ReleaseChips, ReleaseName, ResultThumb } from './ReleaseRow';

/** The size in the phone's one format («1,5 ГБ»), whatever the tracker wrote («1.45 GB»); as written when unreadable. */
export function sizeText(r: SourceResult): string {
  const b = parseSize(r.Size);
  return b && b > 0 ? fmtSize(b) : r.Size || '';
}

/** «152 сида» when the count is known; '' for 0, which is what a feed without seed data gives. */
export function knownSeeds(r: SourceResult): string {
  return r.Seed > 0 ? seedsText(r.Seed) : '';
}

/** «18 GB · 152 сида · сегодня · ещё в Torznab». */
export function resultMeta(r: SourceResult): string {
  const more = r.sources && r.sources.length ? t('add.alsoIn', { names: r.sources.map(sourceName).join(', ') }) : '';
  return [sizeText(r), knownSeeds(r), resultDate(r), more].filter(Boolean).join(' · ');
}

const PLUS = 'M12 5v14M5 12h14';
/** A screen with ▶ in it: «На ТВ». */
const TV_PLAY = 'M3 4h18v13H3zM8 21h8M10 8l5 2.5-5 2.5z';

const pageLink = (r: SourceResult): string => (/^https?:\/\//i.test(r.detailUrl || '') ? r.detailUrl! : '');

/**
 * A found release, compact: the poster down the whole card; the short title with its meta, quality chips,
 * «source · size · seeds», the date with the round «＋» and «▶ ТВ». A tap on the card opens «Подробнее»: the full
 * tracker title, the category, the same two actions as full buttons and «Открыть на сайте».
 */
export function ResultCard(p: {
  r: SourceResult;
  category: string;
  busy?: RowBusy;
  /** A label before the source, e.g. «Новая». */
  flag?: string;
  highlight?: boolean;
  /** A category picked in «Подробнее». */
  onCategory: (id: string) => void;
  onAdd: () => void;
  onWatch: () => void;
}) {
  const { r } = p;
  const [open, setOpen] = useState(false);
  const link = pageLink(r);
  const date = resultDate(r);
  const act = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  return (
    <>
      <div class={'m-result m-result-card m-rc' + (p.highlight ? ' m-hl' : '')} data-title={r.Title} data-highlight={p.highlight ? '' : undefined}>
        <button type="button" class="m-rc-open" aria-label={t('add.detailsOf', { title: r.Title })} aria-haspopup="dialog" onClick={() => setOpen(true)} />
        <ResultThumb title={r.Title} />
        <div class="m-rc-text">
          <ReleaseName raw={r.Title} />
          <ReleaseChips raw={r.Title} />
          <div class="m-rc-meta m-small m-muted">
            {p.flag && <span class="m-flag">{p.flag}</span>}
            <span class="m-src-badge">{sourceBadge(r)}</span>
            <span class="m-rc-meta-text">{[sizeText(r), knownSeeds(r)].filter(Boolean).join(' · ')}</span>
          </div>
          <div class="m-rc-bottom">
            {p.busy === 'link' ? (
              <span class="m-rc-date m-small m-muted" role="status">
                {t('add.gettingLink')}
              </span>
            ) : (
              <span class="m-rc-date m-small m-muted">{date}</span>
            )}
            <button
              type="button"
              class="m-rc-btn"
              aria-label={t('add.addToServer', { title: r.Title })}
              disabled={!!p.busy}
              onClick={p.onAdd}
            >
              <Icon d={PLUS} size={22} />
            </button>
            <button
              type="button"
              class="m-rc-btn m-rc-btn-tv"
              aria-label={t('add.addAndWatch', { title: r.Title })}
              disabled={!!p.busy}
              onClick={p.onWatch}
            >
              <Icon d={TV_PLAY} size={22} />
            </button>
          </div>
        </div>
      </div>
      {open && (
        <Sheet label={t('common.more')} onClose={() => setOpen(false)}>
          <div class="m-sheet-scroll m-rc-sheet" data-result-details="">
            <ReleaseName raw={r.Title} class="m-rc-sheet-title" />
            <ReleaseChips raw={r.Title} />
            <div class="m-rc-raw m-small m-muted" data-raw-title="">
              {r.Title}
            </div>
            <div class="m-result-meta m-small">
              {p.flag && <span class="m-flag">{p.flag}</span>}
              <span class="m-src-badge">{sourceBadge(r)}</span>
              <span class="m-muted">{resultMeta(r)}</span>
            </div>
            <div class="m-rc-sheet-label m-small m-muted">{t('add.category')}</div>
            <div class="m-chips" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('add.category')}>
              {addCategories().map((c) => (
                <button
                  key={c.id}
                  type="button"
                  class={'m-chip' + (p.category === c.id ? ' on' : '')}
                  aria-pressed={p.category === c.id}
                  onClick={() => p.onCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {link && (
              <button type="button" class="m-link" onClick={() => window.open(link, '_system')}>
                {t('add.openOnSite')}
              </button>
            )}
          </div>
          {p.busy === 'link' && (
            <div class="m-muted m-small" role="status">
              {t('add.gettingLink')}
            </div>
          )}
          <div class="m-sheet-row">
            <button type="button" class="m-btn m-btn-secondary" disabled={!!p.busy} onClick={act(p.onAdd)}>
              {t('common.add')}
            </button>
            <button type="button" class="m-btn m-btn-primary" disabled={!!p.busy} onClick={act(p.onWatch)}>
              {t('add.onTv')}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
