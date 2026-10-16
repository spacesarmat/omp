// «Сейчас на ТВ» as three pages. A swipe down pulls the card down and the remote in from the top;
// a swipe up pulls the card up and the episodes of this release in from below. A sideways swipe on an episode plays it.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t } from '../../../src/i18n';
import type { TorrentFile } from '../../../src/lib/episodes';
import { baseName, episodeLabel, parseEpisode, playableFiles, stripExt } from '../../../src/lib/episodes';
import { getLocalProgress } from '../../../src/store/progress';
import { torrents } from '../../../src/store/library';
import { libraryTorrent } from '../lib/playingNames';
import { sharedResume } from '../lib/sharedProgress';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { useBackHandler } from '../ui/backStack';
import { Icon, ICONS } from '../ui/Icon';
import { swipeBlocked } from '../ui/tabSwipe';
import { filesOf, useTvLaunch } from '../watch';
import { deckPaneAfter, episodeSwipePlays, type DeckPane } from './nowDeck';

/** Where a vertical drag from the current pane is heading (for the peek chip). */
export function deckPeekToward(pane: DeckPane, shift: number): 'remote' | 'episodes' | 'now' | null {
  if (Math.abs(shift) < 16) return null;
  if (shift > 0) return pane === 'now' ? 'remote' : pane === 'episodes' ? 'now' : null;
  return pane === 'now' ? 'episodes' : pane === 'remote' ? 'now' : null;
}

function ordered(files: TorrentFile[]): TorrentFile[] {
  return files.slice().sort((a, b) => {
    const pa = parseEpisode(a.path);
    const pb = parseEpisode(b.path);
    const sa = pa.season === null ? 999 : pa.season;
    const sb = pb.season === null ? 999 : pb.season;
    if (sa !== sb) return sa - sb;
    const ea = pa.episode === null ? 999 : pa.episode;
    const eb = pb.episode === null ? 999 : pb.episode;
    if (ea !== eb) return ea - eb;
    return a.id - b.id;
  });
}

function EpisodeRow({ file, on, onPlay }: { file: TorrentFile; on: boolean; onPlay: (file: TorrentFile) => void }) {
  const [slide, setSlide] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const playRef = useRef(onPlay);
  playRef.current = onPlay;
  const code = episodeLabel(file.path);
  const name = stripExt(baseName(file.path));
  const label = code && name && name !== code ? code + ' · ' + name : code || name;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let x = 0;
    let y = 0;
    let t0 = 0;
    let dx = 0;
    let dy = 0;
    const point = (e: TouchEvent) => e.changedTouches[0] || e.touches[0];
    const start = (e: TouchEvent) => {
      const p = point(e);
      if (!p) return;
      x = p.clientX;
      y = p.clientY;
      t0 = Date.now();
      dx = 0;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      const p = point(e);
      if (!p) return;
      dx = p.clientX - x;
      dy = p.clientY - y;
      if (Math.abs(dx) > Math.abs(dy)) setSlide(dx);
    };
    const end = () => {
      setSlide(0);
      if (episodeSwipePlays(dx, dy, Date.now() - t0)) playRef.current(file);
      dx = 0;
      dy = 0;
    };
    const cancel = () => setSlide(0);
    node.addEventListener('touchstart', start);
    node.addEventListener('touchmove', move);
    node.addEventListener('touchend', end);
    node.addEventListener('touchcancel', cancel);
    return () => {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', cancel);
    };
  }, [file]);
  const pulling = Math.abs(slide) > 12;
  const strength = Math.min(1, Math.abs(slide) / 72);
  return (
    <div class={'m-now-ep-wrap' + (pulling ? ' pulling' : '') + (on ? ' on' : '')}>
      <div
        class={'m-now-ep-rail' + (slide < 0 ? ' right' : slide > 0 ? ' left' : '')}
        style={{ opacity: pulling ? 0.35 + strength * 0.65 : 0 }}
        aria-hidden="true"
      >
        <span class="m-now-ep-rail-icon" style={{ transform: 'scale(' + (0.85 + strength * 0.2) + ')' }}>
          <Icon d={ICONS.play} size={22} />
        </span>
        <span class="m-now-ep-rail-label">{t('now.swipePlay')}</span>
      </div>
      <div
        ref={ref}
        class={'m-now-ep' + (on ? ' on' : '') + (pulling ? ' dragging' : '')}
        style={slide ? { transform: 'translateX(' + slide + 'px)' } : undefined}
      >
        <span class="m-now-ep-chev left" aria-hidden="true">
          <Icon d={ICONS.collapse} size={14} />
        </span>
        <span class="m-now-ep-title">{label}</span>
        <span class="m-now-ep-chev right" aria-hidden="true">
          <Icon d={ICONS.collapse} size={14} />
        </span>
      </div>
    </div>
  );
}

function Episodes({ hash, fileId, onPlay }: { hash: string; fileId: number; onPlay: (file: TorrentFile) => void }) {
  void torrents.value;
  const tor = libraryTorrent(hash);
  const files = tor ? ordered(playableFiles(filesOf(tor))) : [];
  return (
    <div class="m-now-eps">
      <h2>{t('torrent.screen.episodesHead')}</h2>
      {!tor ? (
        <p class="m-small m-muted">{t('now.noRelease')}</p>
      ) : !files.length ? (
        <p class="m-small m-muted">{t('titleCard.noEpisodes')}</p>
      ) : (
        <>
          <p class="m-now-ep-hint m-small m-muted">
            <Icon d={ICONS.play} size={14} />
            <span>{t('now.swipeEpisode')}</span>
          </p>
          {files.map((f) => (
            <EpisodeRow key={f.id} file={f} on={f.id === fileId} onPlay={onPlay} />
          ))}
        </>
      )}
    </div>
  );
}

export function NowDeck({
  hash,
  fileId,
  remote,
  children,
}: {
  hash: string;
  fileId: number;
  remote: ComponentChildren;
  children: ComponentChildren;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<DeckPane>('now');
  const [shift, setShift] = useState(0);
  const [anim, setAnim] = useState(true);
  const [height, setHeight] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 1));
  const [opened, setOpened] = useState({ remote: false, episodes: false });
  const paneRef = useRef(pane);
  const shiftRef = useRef(0);
  const heightRef = useRef(height);
  paneRef.current = pane;
  heightRef.current = height;
  const launch = useTvLaunch();
  useBackHandler(() => setPane('now'), pane !== 'now');

  useLayoutEffect(() => {
    const measure = () => {
      const h = stage.current && stage.current.clientHeight > 0 ? stage.current.clientHeight : window.innerHeight || 1;
      heightRef.current = h;
      setHeight(h);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let mode: 'idle' | 'maybe' | 'deck' | 'scroll' = 'idle';
    let origin: DeckPane = 'now';
    let scroller: HTMLElement | null = null;

    const atEdge = (dy: number) => {
      const el = scroller;
      if (!el) return true;
      if (dy > 0) return el.scrollTop <= 0;
      return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    };

    const start = (e: TouchEvent) => {
      mode = 'idle';
      if (e.touches.length !== 1) return;
      if (swipeBlocked(e.target as Element | null)) return;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startT = Date.now();
      origin = paneRef.current;
      scroller = (e.target as Element).closest('.m-now-pane') as HTMLElement | null;
      shiftRef.current = 0;
      mode = 'maybe';
    };
    const move = (e: TouchEvent) => {
      if (mode === 'idle' || mode === 'scroll') return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (mode === 'maybe') {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          mode = 'scroll';
          return;
        }
        const down = dy > 0 && atEdge(dy) && origin !== 'remote';
        const up = dy < 0 && atEdge(dy) && origin !== 'episodes';
        if (!down && !up) {
          mode = 'scroll';
          return;
        }
        mode = 'deck';
        setOpened((o) => ({
          remote: o.remote || down || origin === 'remote',
          episodes: o.episodes || up || origin === 'episodes',
        }));
        setAnim(false);
      }
      if (e.cancelable) e.preventDefault();
      let y = dy;
      if (origin === 'remote' && dy > 0) y = dy * 0.25;
      if (origin === 'episodes' && dy < 0) y = dy * 0.25;
      shiftRef.current = y;
      setShift(y);
    };
    const end = () => {
      if (mode === 'deck') {
        const next = deckPaneAfter(origin, shiftRef.current, Date.now() - startT, heightRef.current);
        setAnim(true);
        setShift(0);
        shiftRef.current = 0;
        setPane(next);
        if (next !== 'now') {
          setOpened((o) => ({ remote: o.remote || next === 'remote', episodes: o.episodes || next === 'episodes' }));
        }
      }
      mode = 'idle';
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
    return () => {
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', end);
    };
  }, []);

  const play = (file: TorrentFile) => {
    if (!activeTv.value) {
      navigate({ name: 'tv' });
      return;
    }
    const code = episodeLabel(file.path);
    void launch
      .start({
        hash,
        file: file.id,
        at: sharedResume(hash, file.id),
        duration: getLocalProgress(hash, file.id)?.duration || undefined,
        label: [code, stripExt(baseName(file.path))].filter(Boolean).join(' · '),
      })
      .then(() => setPane('now'));
  };

  const index = pane === 'remote' ? 0 : pane === 'episodes' ? 2 : 1;
  const toward = deckPeekToward(pane, shift);
  const peekStrength = Math.min(1, Math.abs(shift) / Math.max(80, height * 0.18));
  return (
    <div class="m-now-deck" ref={stage} data-pane={pane} data-peek={toward || ''}>
      <div
        class={'m-now-track' + (anim ? ' anim' : '')}
        style={{ transform: 'translateY(' + (-index * height + shift) + 'px)' }}
      >
        <section class="m-now-pane" data-pane="remote">
          {opened.remote || pane === 'remote' ? remote : null}
        </section>
        <section class="m-now-pane" data-pane="now">
          {children}
        </section>
        <section class="m-now-pane" data-pane="episodes">
          {opened.episodes || pane === 'episodes' ? <Episodes hash={hash} fileId={fileId} onPlay={play} /> : null}
        </section>
      </div>
      {pane === 'now' && !toward && (
        <>
          <div class="m-now-edge m-now-edge-top" aria-hidden="true">
            <span class="m-now-edge-chev">
              <Icon d={ICONS.collapse} size={16} />
            </span>
            <Icon d={ICONS.remote} size={18} />
            <span>{t('now.swipeRemote')}</span>
          </div>
          <div class="m-now-edge m-now-edge-bot" aria-hidden="true">
            <Icon d={ICONS['view-list']} size={18} />
            <span>{t('now.swipeEpisodes')}</span>
            <span class="m-now-edge-chev up">
              <Icon d={ICONS.collapse} size={16} />
            </span>
          </div>
        </>
      )}
      {toward && (
        <div
          class={'m-now-peek m-now-peek-' + toward}
          style={{
            opacity: 0.45 + peekStrength * 0.55,
            transform: 'translateX(-50%) scale(' + (0.92 + peekStrength * 0.08) + ')',
          }}
          aria-hidden="true"
        >
          <span class="m-now-peek-icon">
            <Icon
              d={toward === 'remote' ? ICONS.remote : toward === 'episodes' ? ICONS['view-list'] : ICONS.collapse}
              size={28}
            />
          </span>
          <span class="m-now-peek-label">
            {toward === 'remote'
              ? t('now.swipeRemoteHint')
              : toward === 'episodes'
                ? t('now.swipeEpisodesHint')
                : t('now.kicker')}
          </span>
        </div>
      )}
      {launch.sheet}
    </div>
  );
}
