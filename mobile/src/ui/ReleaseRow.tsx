// The parts of a found-release row: the short title with its meta («Тёмная материя · 2 сезон · серии 1–6 из 10»),
// quality chips, the full tracker title (one muted line, the whole of it on tap: people pick releases by it) and a
// small poster that is looked up only once the row is on screen.
import { useEffect, useRef, useState } from 'preact/hooks';
import { posterColor } from '../../../src/lib/libraryView';
import { releaseChips, releaseTitle } from '../../../src/sources/releaseRow';
import { posterKey, requestPoster } from './resultPosters';

export { releaseChips, releaseTitle };

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
