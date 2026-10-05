// The parts of a found-release row: the short title with its meta («Тёмная материя · 2 сезон · серии 1–6 из 10»),
// quality chips, the full tracker title (one muted line, the whole of it on tap: people pick releases by it) and a
// small poster that is looked up only once the row is on screen.
import { useEffect, useRef, useState } from 'preact/hooks';
import { libraryTitle, posterColor, type LibraryTitle } from '../../../src/lib/libraryView';
import { displayBadge, parseReleaseInfo } from '../../../src/lib/releaseInfo';
import { parseRelease } from '../../../src/sources/filters';
import { t } from '../../../src/i18n';
import { posterKey, requestPoster } from './resultPosters';

/** «Звездный путь: Странные новые миры» + «1–4 сезоны · серии 1–40 из 40» from a tracker title. */
export function releaseTitle(raw: string): LibraryTitle {
  return libraryTitle({ hash: '', title: raw || '' });
}

/** Quality chips: resolution, HDR, source and voice-over, e.g. ['4K', 'HDR', 'WEB-DL', 'Дубляж']. */
export function releaseChips(raw: string): string[] {
  const info = parseReleaseInfo(raw || '');
  const out: string[] = [];
  if (info.resolution) out.push(displayBadge(info.resolution));
  if (info.hdr) out.push(info.hdr);
  if (info.source) out.push(info.source);
  const r = parseRelease(raw || '');
  if (r.dub) out.push(t('filters.dubChip'));
  else if (r.mvo) out.push(t('filters.mvoChip'));
  else if (r.original) out.push(t('filters.originalChip'));
  return out;
}

/** The short title with its « · meta» span. */
export function ReleaseName({ raw, class: cls = 'm-result-title' }: { raw: string; class?: string }) {
  const s = releaseTitle(raw);
  return (
    <div class={cls}>
      {s.title}
      {s.meta && <span class="m-title-meta">{' · ' + s.meta}</span>}
    </div>
  );
}

export function ReleaseChips({ raw }: { raw: string }) {
  const chips = releaseChips(raw);
  if (!chips.length) return null;
  return (
    <div class="m-rel-chips">
      {chips.map((c) => (
        <span key={c} class="m-badge-inline">
          {c}
        </span>
      ))}
    </div>
  );
}

/** True when the short title says less than the tracker title (otherwise the full line would only repeat it). */
export function hasRawLine(raw: string): boolean {
  const s = releaseTitle(raw);
  return s.title !== (raw || '').trim() || !!s.meta;
}

/** The full tracker title: one muted line, the whole of it after a tap (and one line again after another). */
export function RawTitle({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      class={'m-raw-title m-muted m-small' + (open ? ' open' : '')}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      {raw}
    </button>
  );
}

const cssUrl = (u: string) => u.replace(/["()\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/**
 * A fixed-size poster thumbnail: the colour placeholder at once, the poster once the row has been on screen and the
 * lookup answered. `poster` (a library torrent's own) skips the lookup.
 */
export function ResultThumb({ title, poster }: { title: string; poster?: string }) {
  const own = /^https?:\/\//i.test(poster || '') ? poster! : '';
  const [url, setUrl] = useState(own);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setUrl(own);
    if (own) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    let cancel: (() => void) | null = null;
    const io = new IntersectionObserver(
      (list) => {
        if (!list.some((x) => x.isIntersecting)) return;
        io.disconnect();
        if (!cancel) cancel = requestPoster(title, (u) => setUrl(/^https?:\/\//i.test(u) ? u : ''));
      },
      { rootMargin: '200px 0px' },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      if (cancel) cancel();
    };
  }, [title, own]);
  const color = posterColor(posterKey(title) || title || '?');
  const bg = `linear-gradient(160deg, ${color}, #14161C)`;
  const style = url ? `background: url("${cssUrl(url)}") center / cover, ${bg}` : `background: ${bg}`;
  return <div ref={ref} class="m-rel-thumb" style={style} data-poster-url={url || undefined} aria-hidden="true" />;
}
