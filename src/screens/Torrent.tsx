import { useEffect, useMemo, useState } from 'preact/hooks';
import { client } from '../store/servers';
import { torrents } from '../store/library';
import { getLocalProgress, progressVersion, serverViewed, refreshViewed, isWatched, resumePosition, progressRatio, clearProgress } from '../store/progress';
import type { Torrent } from '../api/types';
import { errorMessage } from '../api/http';
import { TorrentFile, baseName, groupBySeason, playableFiles, episodeLabel } from '../lib/episodes';
import { formatBytes, formatDuration, formatSpeed } from '../lib/format';
import { parseReleaseInfo, releaseBadges } from '../lib/releaseInfo';
import { buildTorrentQueue } from '../player/queue';
import { navigate, goBack } from '../ui/nav';
import { FocusGroup, Focusable, Button, Spinner, ProgressBar } from '../ui/components';
import { Icon, KeyDot } from '../ui/icons';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { useKeys } from '../ui/keys';
import { useSkip, firstPlayableId } from '../lib/useSkip';
import { skipStatus } from '../lib/skipMarks';
import { MarksDialog } from '../ui/MarksDialog';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { displayTitle } from '../lib/torrentName';
import { t } from '../i18n';

export function TorrentScreen({ hash }: { hash: string }) {
  const c = client.value!;
  const cached = torrents.value.find((tor) => tor.hash === hash) || null;
  const [tor, setT] = useState<Torrent | null>(cached);
  const [files, setFiles] = useState<TorrentFile[]>(cached ? c.files(cached) : []);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // subscribe to progress changes
  progressVersion.value;
  serverViewed.value;

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

  useEffect(() => {
    restoreFocus('TORRENT-ACTIONS');
  }, [files.length > 0]);

  const play = (index: number, startAt?: number) => {
    if (index >= 0) navigate({ name: 'player', queue, index, startAt });
  };

  const remove = () => {
    confirmDialog(t('torrent.deleteAsk'), t('tv.delete')).then((ok) => {
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

  return (
    <FocusGroup focusKey="TORRENT" className="screen torrent">
      <div class="torrent-head">
        {tor && tor.poster ? <img src={tor.poster} alt="" /> : null}
        <div class="info">
          <h1>{tor ? displayTitle(tor) : hash}</h1>
          <div class="muted">
            {tor && tor.torrent_size ? formatBytes(tor.torrent_size) + ' · ' : ''}
            {tor && tor.stat_string ? tor.stat_string : ''}
            {tor && tor.stat === 3 ? ' · ' + formatSpeed(tor.download_speed || 0) + ' · ' + t('torrent.peers', { a: tor.active_peers || 0, b: tor.total_peers || 0 }) : ''}
          </div>
          {(() => {
            const badges = releaseBadges(parseReleaseInfo(tor ? displayTitle(tor) : ''));
            return badges.length ? <div class="badges">{badges.map((x) => <span key={x} class="badge">{x}</span>)}</div> : null;
          })()}
          <FocusGroup focusKey="TORRENT-ACTIONS" className="row" preferredChildFocusKey="torrent-play">
            {queue.length > 0 && <Button focusKey="torrent-play" label={playLabel} onPress={() => play(target, targetPos || undefined)} />}
            {queue.length > 0 && <Button label={t('playlist.title')} onPress={() => navigate({ name: 'playlist', url: c.playlistUrl(hash), title: tor ? displayTitle(tor) : '' })} />}
            <Button label={t('torrent.resetViewed')} onPress={resetViewed} />
            <Button label={t('tv.delete')} onPress={remove} />
          </FocusGroup>
        </div>
      </div>
      {queue.length > 0 && (
        <FocusGroup focusKey="TORRENT-SKIP" className="skip-block">
          <div class="skip-head">
            <span class="skip-title">{t('torrent.skip')}</span>
            <span class="muted">{t('torrent.skipSub')}</span>
          </div>
          <Focusable focusKey="skip-intro" className="skip-row" onPress={() => toggleSkip('i')}>
            <span class="skip-label">{t('torrent.skipIntro')}</span>
            <span class={'skip-switch' + (skip.prefs.i ? ' on' : '')} role="switch" aria-label={t('torrent.skipIntro')} aria-checked={skip.prefs.i} />
          </Focusable>
          <Focusable focusKey="skip-credits" className="skip-row" onPress={() => toggleSkip('c')}>
            <span class="skip-label">{t('torrent.skipCredits')}</span>
            <span class={'skip-switch' + (skip.prefs.c ? ' on' : '')} role="switch" aria-label={t('torrent.skipCreditsShort')} aria-checked={skip.prefs.c} />
          </Focusable>
          <Focusable focusKey="skip-status" className="skip-row skip-status" role="button" ariaLabel={t('torrent.marksAria')} onPress={() => setMarksOpen(true)}>
            <span class="skip-label">{t('tv.marks.title')}</span>
            <span class="muted">{skipStatus(skip.hasChapters, skip.prefs)}</span>
          </Focusable>
        </FocusGroup>
      )}
      {marksOpen && (
        <MarksDialog
          subtitle={t('torrent.marksSub', { title: tor ? displayTitle(tor) : '' })}
          prefs={{ mi: skip.prefs.mi || null, mc: skip.prefs.mc || null }}
          onSave={(m) => skip.save({ mi: m.mi, mc: m.mc }, false)}
          onClose={closeMarks}
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
                >
                  <span class="ep">{episodeLabel(f.path)}</span>
                  <span class="name">{baseName(f.path)}</span>
                  {!watched && ratio > 0 && <span class="bar"><ProgressBar ratio={ratio} /></span>}
                  <span class="size">{formatBytes(f.length)}</span>
                  <span class="check">{watched ? <Icon name="check" size={28} /> : null}</span>
                </Focusable>
              );
            })}
          </section>
        ))}
      </FocusGroup>
      <div class="hints">{t('torrent.hintOk')} · <KeyDot color="red" /> {t('torrent.hintDelete')} · {t('torrent.hintBack')}</div>
    </FocusGroup>
  );
}
