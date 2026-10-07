import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useTorrentCast } from '../lib/useTorrentCast';
import { CastRow } from '../ui/CastRow';
import { client } from '../store/servers';
import { torrents } from '../store/library';
import { getLocalProgress, progressVersion, serverViewed, refreshViewed, isWatched, resumePosition, progressRatio, clearProgress } from '../store/progress';
import type { Torrent } from '../api/types';
import { errorMessage } from '../api/http';
import { TorrentFile, baseName, groupBySeason, playableFiles, episodeLabel } from '../lib/episodes';
import { formatDuration } from '../lib/format';
import { fmtBytes } from '../i18n';
import { statusLine } from '../lib/torrentStatus';
import { seriesGroupOf, torrentName } from '../lib/cleanNames';
import { requestSeriesMatch, seriesMatchVersion } from '../lib/seriesMatch';
import { parseReleaseInfo, releaseBadges } from '../lib/releaseInfo';
import { buildTorrentQueue } from '../player/queue';
import { navigate, goBack, replaceRoute } from '../ui/nav';
import { FocusGroup, Focusable, Button, Spinner, ProgressBar } from '../ui/components';
import { Icon, KeyDot } from '../ui/icons';
import { restoreFocus, scrollToShow } from '../ui/focus';
import { confirmDialog, choose } from '../ui/dialog';
import { askText } from '../ui/TextDialog';
import { checkTitle, renameTorrent } from '../lib/renameTorrent';
import { activeCatalog } from '../catalog/activeCatalog';
import { catalogErrorCode } from '../catalog/client';
import { libraryTitle } from '../lib/libraryView';
import { toast } from '../ui/toast';
import { useKeys } from '../ui/keys';
import { useSkip, firstPlayableId } from '../lib/useSkip';
import { skipStatus } from '../lib/skipMarks';
import { MarksDialog } from '../ui/MarksDialog';
import { BetterDialog, canUpgrade } from '../ui/BetterDialog';
import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { displayTitle } from '../lib/torrentName';
import { t } from '../i18n';
import { tvGlyphs } from '../ui/tvText';

/** Inner margin of the actions row: a focused button keeps this much room to the row's edge. */
const ACTION_PAD = 24;

/** The parts of the screen the hint bar follows. */
export type TorrentArea = 'play' | 'actions' | 'skip' | 'marks' | 'files';

/** What OK does in each part of the screen. */
export function okHint(area: TorrentArea): string {
  if (area === 'skip') return t('torrent.hintToggle');
  if (area === 'marks') return t('torrent.hintMarks');
  if (area === 'files' || area === 'play') return t('torrent.hintOk');
  return t('torrent.hintSelect');
}

/** The header's name and the raw release name under it ('' when it adds nothing). */
export function headerNames(tor: Torrent, list: Torrent[]): { name: string; raw: string } {
  const name = torrentName(tor, list);
  const raw = displayTitle(tor);
  return { name: name, raw: raw && raw !== name ? raw : '' };
}

/** The action buttons the row's fallback focus can land on while the files load (all but Watch). */
const AUTO_ACTIONS = ['TORRENT-ACTIONS', 'torrent-reset', 'torrent-rename', 'torrent-poster', 'torrent-delete', 'torrent-better'];

export function TorrentScreen({ hash }: { hash: string }) {
  const c = client.value!;
  const cached = torrents.value.find((tor) => tor.hash === hash) || null;
  const [tor, setT] = useState<Torrent | null>(cached);
  const [files, setFiles] = useState<TorrentFile[]>(cached ? c.files(cached) : []);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // subscribe to progress changes
  progressVersion.value;
  serverViewed.value;
  void seriesMatchVersion.value; // the TMDB name of the series, once looked up
  const list = torrents.value;
  const group = tor ? seriesGroupOf(tor, list) : null;
  const { card: movie, pending: moviePending } = useTorrentCast(tor);
  useEffect(() => {
    if (group) requestSeriesMatch(group);
  }, [group ? group.key : '']);
  // the part of the screen in focus: the hint bar says what OK does there
  const [area, setArea] = useState<TorrentArea>('play');
  const enter = (a: TorrentArea) => {
    if (a !== 'actions' && a !== 'play' && actionsRef.current) actionsRef.current.scrollLeft = 0;
    setArea(a);
  };

  useEffect(() => {
    let dead = false;
    c.get(hash)
      .then((r) => {
        if (dead) return;
        setT(r);
        setLoaded(true);
        const f = c.files(r);
        if (f.length) {
          setFiles(f);
          return;
        }
        setLoadingInfo(true);
        return c.loadInfo(hash).then((info) => {
          if (dead) return;
          setT(info);
          setFiles(c.files(info));
          setLoadingInfo(false);
        });
      })
      .catch((e) => {
        if (dead) return;
        setLoadingInfo(false);
        setError(errorMessage(e));
      });
    refreshViewed(c);
    const timer = setInterval(() => {
      c.get(hash).then((r) => {
        if (dead) return;
        setT(r);
      }, () => undefined);
    }, 3000);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [hash]);

  const queue = useMemo(() => (tor ? buildTorrentQueue(c, tor, files) : []), [tor ? tor.hash : '', files]);
  const groups = useMemo(() => groupBySeason(playableFiles(files)), [files]);

  const skip = useSkip(c, hash, firstPlayableId(files));
  const toggleSkip = (key: 'i' | 'c') => {
    skip.save((p) => (key === 'i' ? { i: !p.i } : { c: !p.c }), true).then(undefined, (e) => toast(errorMessage(e), 'error'));
  };

  const [marksOpen, setMarksOpen] = useState(false);
  const closeMarks = () => {
    setMarksOpen(false);
    setTimeout(() => setFocus('skip-status'), 0);
  };

  const [betterOpen, setBetterOpen] = useState(false);
  const upgradable = useMemo(() => (tor && files.length ? canUpgrade(tor, files) : false), [tor ? tor.hash : '', tor ? tor.title : '', tor ? tor.category : '', files]);

  // a torrent just added has no files yet: Watch is not there, so the row's first button (Reset viewed)
  // takes the focus, and refocusing the row later returns to that last child. When the files arrive and the person has
  // not moved, the cursor goes to Watch, as the search hint (OK adds and watches) promises.
  const filesAtMount = useRef(files.length > 0);
  const keyPressed = useRef(false);
  useEffect(() => {
    const onKey = () => {
      keyPressed.current = true;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    if (files.length > 0 && !filesAtMount.current && !keyPressed.current && AUTO_ACTIONS.indexOf(getCurrentFocusKey() || '') >= 0) {
      setFocus('torrent-play');
      return;
    }
    restoreFocus('TORRENT-ACTIONS');
  }, [files.length > 0]);

  const play = (index: number, startAt?: number) => {
    if (index >= 0) navigate({ name: 'player', queue, index, startAt });
  };

  const remove = () => {
    confirmDialog(t('torrent.deleteAsk'), t('common.delete')).then((ok) => {
      if (!ok) return;
      c.remove(hash).then(
        () => {
          torrents.value = torrents.value.filter((x) => x.hash !== hash);
          toast(t('catalog.torrentDeleted'));
          goBack();
        },
        (e) => toast(errorMessage(e), 'error'),
      );
    });
  };

  const patch = (p: Partial<Torrent>) => {
    setT((cur) => (cur ? { ...cur, ...p } : cur));
    torrents.value = torrents.value.map((x) => (x.hash === hash ? { ...x, ...p } : x));
  };

  const rename = () => {
    if (!tor) return;
    askText(t('torrent.rename.title'), displayTitle(tor)).then((raw) => {
      if (raw === null) return;
      const v = checkTitle(raw);
      if (!v.ok) {
        toast(v.error, 'error');
        return;
      }
      renameTorrent(c, tor, v.title).then(
        (title) => patch({ title }),
        () => toast(t('torrent.rename.saveFailed'), 'error'),
      );
    });
  };

  const otherPoster = () => {
    if (!tor) return;
    activeCatalog()
      .then((cat) => cat.search(libraryTitle(tor).title, 1))
      .then(
        (r) => {
          const opts = r.items
            .filter((x) => !!x.poster)
            .slice(0, 8)
            .map((x) => ({ label: x.year ? x.title + ' · ' + x.year : x.title, value: x.poster }));
          if (!opts.length) {
            toast(t('torrent.poster.none'));
            return;
          }
          return choose(t('torrent.poster.pick'), opts).then((url) => {
            if (!url) return;
            return c.setPoster(tor, url).then(
              () => patch({ poster: url }),
              (e) => toast(errorMessage(e), 'error'),
            );
          });
        },
        (e) => toast(t(catalogErrorCode(e) === 'nokey' ? 'tv.discover.nokeyText' : 'tv.discover.offlineText'), 'error'),
      );
  };

  const resetViewed = () => {
    confirmDialog(t('torrent.resetAsk'), t('tv.marks.reset')).then((ok) => {
      if (!ok) return;
      clearProgress(hash);
      c.removeViewed(hash).then(() => refreshViewed(c), () => undefined);
    });
  };

  useKeys((a) => {
    if (a === 'red') {
      remove();
      return true;
    }
    return false;
  });

  // in-progress file with the most recent local progress (else first in-progress), else first unwatched, else first
  let target = -1;
  let bestUpdated = -Infinity;
  queue.forEach((q, i) => {
    if (resumePosition(hash, q.fileIndex!) <= 0) return;
    const u = getLocalProgress(hash, q.fileIndex!)?.updated;
    if (target < 0 || (u !== undefined && u > bestUpdated)) {
      target = i;
      bestUpdated = u !== undefined ? u : bestUpdated;
    }
  });
  const targetPos = target >= 0 ? resumePosition(hash, queue[target].fileIndex!) : 0;
  if (target < 0) target = queue.findIndex((q) => !isWatched(hash, q.fileIndex!));
  if (target < 0) target = 0;
  const targetLabel = queue[target] ? episodeLabel(queue[target].title) : '';
  const playLabel = targetPos > 0
    ? t('torrent.continueFrom', { ep: targetLabel ? targetLabel + ' ' : '', time: formatDuration(targetPos) })
    : targetLabel ? t('torrent.watchEp', { ep: targetLabel }) : t('torrent.watch');

  // the action buttons do not wrap: the row scrolls sideways so the focused button is whole, with a margin
  const showAction = (key: string) => {
    setArea(key === 'torrent-play' ? 'play' : 'actions');
    const box = actionsRef.current;
    const el = box ? (box.querySelector('[data-fk="' + key + '"]') as HTMLElement | null) : null;
    if (!box || !el) return;
    box.scrollLeft = scrollToShow(box.scrollLeft, box.clientWidth, el.offsetLeft, el.offsetWidth, ACTION_PAD);
  };

  return (
    <FocusGroup focusKey="TORRENT" className="screen torrent">
      <div class="torrent-head">
        {tor && tor.poster ? <img src={tor.poster} alt="" /> : null}
        <div class="info">
          {(() => {
            const n = tor ? headerNames(tor, list) : { name: hash, raw: '' };
            return [
              <h1 key="name">{tvGlyphs(n.name)}</h1>,
              n.raw ? <div key="raw" class="torrent-raw">{tvGlyphs(n.raw)}</div> : null,
            ];
          })()}
          <div class="muted torrent-status">{tor ? tvGlyphs(statusLine(tor)) : ''}</div>
          {(() => {
            const badges = releaseBadges(parseReleaseInfo(tor ? displayTitle(tor) : ''));
            return badges.length ? <div class="badges">{badges.map((x) => <span key={x} class="badge">{x}</span>)}</div> : null;
          })()}
          <div class="torrent-actions" ref={actionsRef}>
            <FocusGroup focusKey="TORRENT-ACTIONS" className="row torrent-actions-row" preferredChildFocusKey="torrent-play">
              {queue.length > 0 && <Button focusKey="torrent-play" label={playLabel} onFocused={() => showAction('torrent-play')} onPress={() => play(target, targetPos || undefined)} />}
              {queue.length > 0 && <Button focusKey="torrent-playlist" label={t('playlist.title')} onFocused={() => showAction('torrent-playlist')} onPress={() => navigate({ name: 'playlist', url: c.playlistUrl(hash), title: tor ? tvGlyphs(torrentName(tor, list)) : '' })} />}
              {upgradable && <Button focusKey="torrent-better" label={t('torrent.better.find')} onFocused={() => showAction('torrent-better')} onPress={() => setBetterOpen(true)} />}
              <Button focusKey="torrent-reset" label={t('torrent.resetViewed')} onFocused={() => showAction('torrent-reset')} onPress={resetViewed} />
              <Button focusKey="torrent-rename" label={t('torrent.rename.title')} onFocused={() => showAction('torrent-rename')} onPress={rename} />
              <Button focusKey="torrent-poster" label={t('torrent.poster.other')} onFocused={() => showAction('torrent-poster')} onPress={otherPoster} />
              <Button focusKey="torrent-delete" label={t('common.delete')} onFocused={() => showAction('torrent-delete')} onPress={remove} />
            </FocusGroup>
          </div>
        </div>
      </div>
      {moviePending && !movie && <div class="tc-section tc-cast-ph" aria-hidden="true" />}
      {movie && movie.cast.length > 0 && <CastRow cast={movie.cast} groupKey="TORRENT-CAST" focusPrefix="torrent-cast-" />}
      {queue.length > 0 && (
        <FocusGroup focusKey="TORRENT-SKIP" className="skip-block">
          <div class="skip-head">
            <span class="skip-title">{t('torrent.skip')}</span>
            <span class="muted">{t('torrent.skipSub')}</span>
          </div>
          <Focusable focusKey="skip-intro" className="skip-row" onPress={() => toggleSkip('i')} onFocused={() => enter('skip')}>
            <span class="skip-label">{t('torrent.skipIntro')}</span>
            <span class={'skip-switch' + (skip.prefs.i ? ' on' : '')} role="switch" aria-label={t('torrent.skipIntro')} aria-checked={skip.prefs.i} />
          </Focusable>
          <Focusable focusKey="skip-credits" className="skip-row" onPress={() => toggleSkip('c')} onFocused={() => enter('skip')}>
            <span class="skip-label">{t('torrent.skipCredits')}</span>
            <span class={'skip-switch' + (skip.prefs.c ? ' on' : '')} role="switch" aria-label={t('torrent.skipCreditsShort')} aria-checked={skip.prefs.c} />
          </Focusable>
          <Focusable focusKey="skip-status" className="skip-row skip-status" role="button" ariaLabel={t('torrent.marksAria')} onPress={() => setMarksOpen(true)} onFocused={() => enter('marks')}>
            <span class="skip-label">{t('tv.marks.title')}</span>
            <span class="muted">{skipStatus(skip.hasChapters, skip.prefs)}</span>
          </Focusable>
        </FocusGroup>
      )}
      {marksOpen && (
        <MarksDialog
          subtitle={t('torrent.marksSub', { title: tor ? tvGlyphs(torrentName(tor, list)) : '' })}
          prefs={{ mi: skip.prefs.mi || null, mc: skip.prefs.mc || null }}
          onSave={(m) => skip.save({ mi: m.mi, mc: m.mc }, false)}
          onClose={closeMarks}
        />
      )}
      {betterOpen && tor && (
        <BetterDialog
          torrent={tor}
          files={files}
          onReplaced={(h) => {
            setBetterOpen(false);
            // the hash changed: the screen of the new torrent takes this one's place
            replaceRoute({ name: 'torrent', hash: h });
          }}
          onClose={() => setBetterOpen(false)}
          focusAfterReplace={['torrent-play']}
        />
      )}
      {loadingInfo && <Spinner text={t('torrent.gettingFiles')} />}
      {error && <div class="banner-error">{error}</div>}
      {!loadingInfo && !error && loaded && files.length === 0 && <div class="empty">{t('torrent.noFiles')}</div>}
      {!loadingInfo && !error && files.length > 0 && queue.length === 0 && <div class="empty">{t('torrent.noMedia')}</div>}
      <FocusGroup focusKey="TORRENT-FILES">
        {groups.map((g) => (
          <section key={String(g.season)}>
            {(groups.length > 1 || g.season !== null) && <h2>{g.season !== null ? t('library.season', { n: g.season }) : t('torrent.other')}</h2>}
            {g.files.map((f) => {
              const watched = isWatched(hash, f.id);
              const ratio = progressRatio(hash, f.id);
              return (
                <Focusable
                  key={f.id}
                  focusKey={'file-' + f.id}
                  className="list-item file-row"
                  onPress={() => play(queue.findIndex((q) => q.fileIndex === f.id))}
                  onFocused={() => enter('files')}
                >
                  <span class="ep">{episodeLabel(f.path)}</span>
                  <span class="name">{tvGlyphs(baseName(f.path))}</span>
                  {!watched && ratio > 0 && <span class="bar"><ProgressBar ratio={ratio} /></span>}
                  <span class="size">{fmtBytes(f.length)}</span>
                  <span class="check">{watched ? <Icon name="check" size={28} /> : null}</span>
                </Focusable>
              );
            })}
          </section>
        ))}
      </FocusGroup>
      <div class="hints">{okHint(area)} · <KeyDot color="red" /> {t('torrent.hintDelete')} · {t('torrent.hintBack')}</div>
    </FocusGroup>
  );
}
