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

export function TorrentScreen({ hash }: { hash: string }) {
  const c = client.value!;
  const cached = torrents.value.find((t) => t.hash === hash) || null;
  const [t, setT] = useState<Torrent | null>(cached);
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

  const queue = useMemo(() => (t ? buildTorrentQueue(c, t, files) : []), [t ? t.hash : '', files]);
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
    confirmDialog('Удалить торрент с сервера?', 'Удалить').then((ok) => {
      if (!ok) return;
      c.remove(hash).then(
        () => {
          torrents.value = torrents.value.filter((x) => x.hash !== hash);
          toast('Торрент удалён');
          goBack();
        },
        (e) => toast(errorMessage(e), 'error'),
      );
    });
  };

  const resetViewed = () => {
    confirmDialog('Сбросить отметки просмотра?', 'Сбросить').then((ok) => {
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
    ? 'Продолжить ' + (targetLabel ? targetLabel + ' ' : '') + 'с ' + formatDuration(targetPos)
    : 'Смотреть' + (targetLabel ? ' ' + targetLabel : '');

  return (
    <FocusGroup focusKey="TORRENT" className="screen torrent">
      <div class="torrent-head">
        {t && t.poster ? <img src={t.poster} alt="" /> : null}
        <div class="info">
          <h1>{t ? t.title || t.name : hash}</h1>
          <div class="muted">
            {t && t.torrent_size ? formatBytes(t.torrent_size) + ' · ' : ''}
            {t && t.stat_string ? t.stat_string : ''}
            {t && t.stat === 3 ? ' · ' + formatSpeed(t.download_speed || 0) + ' · пиры ' + (t.active_peers || 0) + '/' + (t.total_peers || 0) : ''}
          </div>
          {(() => {
            const badges = releaseBadges(parseReleaseInfo(t ? t.title || t.name || '' : ''));
            return badges.length ? <div class="badges">{badges.map((x) => <span key={x} class="badge">{x}</span>)}</div> : null;
          })()}
          <FocusGroup focusKey="TORRENT-ACTIONS" className="row" preferredChildFocusKey="torrent-play">
            {queue.length > 0 && <Button focusKey="torrent-play" label={playLabel} onPress={() => play(target, targetPos || undefined)} />}
            {queue.length > 0 && <Button label="Плейлист" onPress={() => navigate({ name: 'playlist', url: c.playlistUrl(hash), title: t ? t.title : '' })} />}
            <Button label="Сбросить просмотр" onPress={resetViewed} />
            <Button label="Удалить" onPress={remove} />
          </FocusGroup>
        </div>
      </div>
      {queue.length > 0 && (
        <FocusGroup focusKey="TORRENT-SKIP" className="skip-block">
          <div class="skip-head">
            <span class="skip-title">Пропуск</span>
            <span class="muted">для всех серий · общий для ТВ и телефона</span>
          </div>
          <Focusable focusKey="skip-intro" className="skip-row" onPress={() => toggleSkip('i')}>
            <span class="skip-label">Пропускать заставку автоматически</span>
            <span class={'skip-switch' + (skip.prefs.i ? ' on' : '')} role="switch" aria-label="Пропускать заставку автоматически" aria-checked={skip.prefs.i} />
          </Focusable>
          <Focusable focusKey="skip-credits" className="skip-row" onPress={() => toggleSkip('c')}>
            <span class="skip-label">Пропускать титры — сразу следующая серия</span>
            <span class={'skip-switch' + (skip.prefs.c ? ' on' : '')} role="switch" aria-label="Пропускать титры" aria-checked={skip.prefs.c} />
          </Focusable>
          <Focusable focusKey="skip-status" className="skip-row skip-status" onPress={() => setMarksOpen(true)}>
            <span class="skip-label">Заставка и титры</span>
            <span class="muted">{skipStatus(skip.hasChapters, skip.prefs)} · ОК — задать вручную</span>
          </Focusable>
        </FocusGroup>
      )}
      {marksOpen && (
        <MarksDialog
          subtitle={(t ? t.title || t.name || '' : '') + ' · для всех серий · главы файла важнее'}
          prefs={{ mi: skip.prefs.mi || null, mc: skip.prefs.mc || null }}
          onSave={(m) => skip.save({ mi: m.mi, mc: m.mc }, false)}
          onClose={closeMarks}
        />
      )}
      {loadingInfo && <Spinner text="Получение списка файлов…" />}
      {error && <div class="banner-error">{error}</div>}
      {!loadingInfo && !error && loaded && files.length === 0 && <div class="empty">Файлы не найдены</div>}
      {!loadingInfo && !error && files.length > 0 && queue.length === 0 && <div class="empty">В торренте нет видео- или аудиофайлов</div>}
      <FocusGroup focusKey="TORRENT-FILES">
        {groups.map((g) => (
          <section key={String(g.season)}>
            {(groups.length > 1 || g.season !== null) && <h2>{g.season !== null ? 'Сезон ' + g.season : 'Другое'}</h2>}
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
      <div class="hints">OK — смотреть · <KeyDot color="red" /> удалить торрент · Назад — к библиотеке</div>
    </FocusGroup>
  );
}
