import { useEffect, useState } from 'preact/hooks';
import { t, tp } from '../../../src/i18n';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { TorrentRenameSheet } from '../ui/TorrentRenameSheet';
import { qualityBadge, posterStyle } from '../ui/Poster';
import { showToast } from '../ui/toast';
import { LaunchError } from '../ui/LaunchError';
import { currentRoute, goBack, navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { actions, filesOf, recordPhoneWatch, streamUrlFor, tvServerUrl, useTvLaunch } from '../watch';
import { client, activeServer } from '../../../src/store/servers';
import { loadJson, saveJson } from '../../../src/store/storage';
import { torrents, refreshTorrents, findPosters, repairTitles } from '../../../src/store/library';
import {
  refreshViewed,
  progressVersion,
  serverViewed,
  progressRatio,
  isWatched,
  resumePosition,
  getLocalProgress,
} from '../../../src/store/progress';
import type { Torrent as TorrentT } from '../../../src/api/types';
import { errorMessage } from '../../../src/api/http';
import { baseName, episodeLabel, parseEpisode, playableFiles, stripExt, type TorrentFile } from '../../../src/lib/episodes';
import { formatBytes, formatDuration } from '../../../src/lib/format';
import { useSkip, firstPlayableId } from '../../../src/lib/useSkip';
import { parseMark, skipStatus } from '../../../src/lib/skipMarks';
import type { SkipPrefs } from '../../../src/lib/journal';
import { posterColor, shortTitle } from '../../../src/lib/libraryView';
import { loadQualityWatch, loadWatch, saveQualityWatch, saveWatch } from '../../../src/store/journal';
import { isLibraryFilm } from '../../../src/monitor/better';
import { isWatchedSeries } from '../../../src/monitor/newEpisodes';
import { findingsOf, pruneEpisodeFindings, removeFindings } from '../../../src/monitor/subs';
import { BETTER_ID, EPISODES_ID } from '../../../src/monitor/types';
import { reloadMonitor } from '../monitor/ui';
import { deleteTorrents, watchTarget } from '../lib/torrentActions';
import { displayTitle } from '../../../src/lib/torrentName';
import { renameTorrent } from '../../../src/lib/renameTorrent';

const BACK = 'M15 5l-7 7 7 7';
const IMAGE = 'M4 5h16v14H4zM4 16l4.5-4.5 4 4 3-3L20 17M15.5 9.5h.01';
const PENCIL = 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4';
const TRASH = 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3';
const TV = 'M3 5h18v11H3zM8 20h8';
const TV_PLAY = 'M3 5h18v11H3zM8 20h8M10 8.5l4 2.5-4 2.5z';
const PHONE = 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2';
const LINK = 'M9 15l6-6M10 6l1.5-1.5a5 5 0 0 1 7 7L17 13M14 18l-1.5 1.5a5 5 0 0 1-7-7L7 11';
const CHECK = 'M5 12.5l4.5 4.5L19 7';
const CHEVRON = 'M9 6l6 6-6 6';
const CHEVRON_DOWN = 'M6 9l6 6 6-6';
const CHEVRON_UP = 'M6 15l6-6 6 6';
const SKIP_OPEN_KEY = 'tsp.ui.skipOpen';

function fileCode(f: TorrentFile): string {
  return episodeLabel(f.path);
}

function fileTitle(f: TorrentFile): string {
  return stripExt(baseName(f.path));
}

function WatchSheet({ torrent, file, onClose }: { torrent: TorrentT; file: TorrentFile; onClose: () => void }) {
  const c = client.value!;
  const tv = activeTv.value;
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [alive] = useState({ v: true });
  const launch = useTvLaunch();
  const hasAuth = !!activeServer.value?.user;
  useEffect(
    () => () => {
      alive.v = false;
    },
    [],
  );

  const code = fileCode(file);
  const head = [code, fileTitle(file), formatBytes(file.length)].filter(Boolean);

  const onTv = async () => {
    if (!tv) {
      onClose();
      navigate({ name: 'tv' });
      return;
    }
    setStatus(null);
    await launch.start({
      hash: torrent.hash,
      file: file.id,
      at: resumePosition(torrent.hash, file.id),
      duration: getLocalProgress(torrent.hash, file.id)?.duration || undefined,
      label: [code, fileTitle(file)].filter(Boolean).join(' · '),
      onBusy: setBusy,
      onError: (m) => setStatus(m ? { kind: 'error', text: m } : null),
      onLaunched: (name) => setStatus({ kind: 'ok', text: t('add.launchedOn', { name: name }) }),
    });
  };

  const onPhone = async () => {
    try {
      await actions.openExternal(streamUrlFor(c, torrent, file), 'video/*');
      void recordPhoneWatch(c, torrent.hash, file.id, 0, getLocalProgress(torrent.hash, file.id)?.duration || 0);
      if (alive.v) onClose();
    } catch (e) {
      if (alive.v) setStatus({ kind: 'error', text: errorMessage(e) });
    }
  };

  const onCopy = async (withAuth: boolean) => {
    try {
      await actions.copyText(await tvServerUrl(streamUrlFor(c, torrent, file, withAuth)));
      showToast(withAuth && hasAuth ? t('torrent.screen.linkCopiedAuth') : t('torrent.screen.linkCopied'));
      if (alive.v) onClose();
    } catch (e) {
      if (alive.v) setStatus({ kind: 'error', text: errorMessage(e) });
    }
  };

  return (
    <Sheet onClose={onClose} label={t('torrent.screen.whereLabel')}>
      <div class="m-muted m-small">{head.join(' · ')}</div>
      <div class="m-sheet-title">{t('torrent.screen.whereTitle')}</div>
      <button type="button" class="m-opt primary" disabled={busy} onClick={onTv}>
        <Icon d={TV} size={26} />
        <span class="m-opt-text">
          <span class="m-opt-name">{tv ? t('torrent.screen.onTvNamed', { name: tv.name }) : t('torrent.screen.onTv')}</span>
          <span class="m-opt-sub">{tv ? t('torrent.screen.onTvSub') : t('torrent.screen.connectTvFirst')}</span>
        </span>
      </button>
      <button type="button" class="m-opt" onClick={onPhone}>
        <Icon d={PHONE} size={26} />
        <span class="m-opt-text">
          <span class="m-opt-name">{t('torrent.screen.onPhone')}</span>
          <span class="m-opt-sub">{t('torrent.screen.onPhoneSub')}</span>
        </span>
      </button>
      <button type="button" class="m-opt" onClick={() => onCopy(true)}>
        <Icon d={LINK} size={26} />
        <span class="m-opt-text">
          <span class="m-opt-name">{t('torrent.screen.copyLink')}</span>
          <span class="m-opt-sub">
            {hasAuth ? t('torrent.screen.copyLinkAuth') : t('torrent.screen.copyLinkSub')}
          </span>
        </span>
      </button>
      {hasAuth && (
        <button type="button" class="m-opt" onClick={() => onCopy(false)}>
          <Icon d={LINK} size={26} />
          <span class="m-opt-text">
            <span class="m-opt-name">{t('torrent.screen.copyNoPassword')}</span>
            <span class="m-opt-sub">{t('torrent.screen.copyNoPasswordSub')}</span>
          </span>
        </button>
      )}
      {status && status.kind === 'error' && <LaunchError message={status.text} class="m-status-err" />}
      {status && status.kind === 'ok' && (
        <div class="m-status-ok" role="status">
          <Icon d={CHECK} size={18} />
          {status.text}
        </div>
      )}
      {launch.sheet}
    </Sheet>
  );
}

function SkipSwitch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} class={'m-switch' + (on ? ' on' : '')} onClick={onToggle}>
      <span class="m-switch-knob" />
    </button>
  );
}

type Marks = { mi: [number, number] | null; mc: number | null };
const badTime = (): string => t('torrent.screen.badTime');

/** «Заставка и титры»: manual marks for the whole torrent (used when the file has no chapters). */
function MarksSheet({ title, prefs, onSave, onClose }: { title: string; prefs: SkipPrefs; onSave: (p: Marks) => Promise<unknown>; onClose: () => void }) {
  const [from, setFrom] = useState(prefs.mi ? formatDuration(prefs.mi[0]) : '');
  const [to, setTo] = useState(prefs.mi ? formatDuration(prefs.mi[1]) : '');
  const [last, setLast] = useState(prefs.mc ? formatDuration(prefs.mc) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [alive] = useState({ v: true });
  useEffect(
    () => () => {
      alive.v = false;
    },
    [],
  );

  const write = (p: Marks) => {
    setBusy(true);
    onSave(p).then(
      () => onClose(),
      (e) => {
        if (!alive.v) return;
        setBusy(false);
        setError(errorMessage(e));
        showToast(errorMessage(e));
      },
    );
  };

  const save = () => {
    const f = from.trim();
    const tt = to.trim();
    const l = last.trim();
    let mi: [number, number] | null = null;
    let mc: number | null = null;
    if (f || tt) {
      const a = parseMark(f);
      const b = parseMark(tt);
      if (a === null || b === null) return setError(badTime());
      if (b <= a) return setError(t('torrent.screen.introEndLater'));
      mi = [a, b];
    }
    if (l) {
      const m = parseMark(l);
      if (m === null || m <= 0) return setError(badTime());
      mc = m;
    }
    setError('');
    write({ mi, mc });
  };

  return (
    <Sheet onClose={onClose} label={t('tv.marks.title')}>
      <div class="m-sheet-title">{t('tv.marks.title')}</div>
      <div class="m-muted m-small">{t('torrent.screen.marksText', { title: title })}</div>
      <div class="m-section">{t('torrent.screen.marksIntro')}</div>
      <div class="m-marks-pair">
        <div class="m-field">
          <label for="m-mark-from">{t('torrent.screen.marksFrom')}</label>
          <input id="m-mark-from" class="m-input" type="text" inputMode="numeric" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
        </div>
        <div class="m-field">
          <label for="m-mark-to">{t('torrent.screen.marksTo')}</label>
          <input id="m-mark-to" class="m-input" type="text" inputMode="numeric" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
        </div>
      </div>
      <div class="m-section">{t('torrent.screen.marksCredits')}</div>
      <div class="m-field">
        <label for="m-mark-last">{t('torrent.screen.marksLast')}</label>
        <input id="m-mark-last" class="m-input" type="text" inputMode="numeric" value={last} onInput={(e) => setLast((e.target as HTMLInputElement).value)} />
      </div>
      <div class="m-muted m-small">{t('torrent.screen.marksHint')}</div>
      {error && (
        <div class="m-error" role="alert">
          {error}
        </div>
      )}
      <div class="m-marks-actions">
        <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={() => write({ mi: null, mc: null })}>
          {t('common.reset')}
        </button>
        <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={save}>
          {t('common.save')}
        </button>
      </div>
    </Sheet>
  );
}

export function Torrent({ hash }: { hash: string }) {
  const c = client.value;
  const listed = torrents.value.find((x) => x.hash === hash);
  // a torrent just added may not be in the list yet: ask the server for it
  const [fetched, setFetched] = useState<TorrentT | null | undefined>(undefined);
  const tor = listed || fetched || undefined;
  const [loaded, setLoaded] = useState<TorrentT | null>(null);
  const [sheet, setSheet] = useState<TorrentFile | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const launch = useTvLaunch();
  const [marksOpen, setMarksOpen] = useState(false);
  // the «Skip» block is folded by default; the choice is remembered across torrents
  const [skipOpen, setSkipOpen] = useState(() => loadJson<boolean>(SKIP_OPEN_KEY, false, (v) => typeof v === 'boolean'));
  const toggleSkipOpen = () => {
    const next = !skipOpen;
    setSkipOpen(next);
    saveJson(SKIP_OPEN_KEY, next);
  };
  const [finding, setFinding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // «Follow new episodes» (omp.w in the journal); null until read from the server
  const [watchNew, setWatchNew] = useState<boolean | null>(null);
  // «Watch the quality» (omp.q in the journal); null until read from the server
  const [watchQuality, setWatchQuality] = useState<boolean | null>(null);
  progressVersion.value;
  serverViewed.value;

  const own = tor ? filesOf(tor) : [];
  const allFiles = own.length ? own : loaded ? filesOf(loaded) : [];
  const skip = useSkip(c, hash, firstPlayableId(allFiles), !!tor);
  // file list comes from the list entry; load it from the server if the entry has none
  useEffect(() => {
    if (!c || !tor || own.length) return;
    let alive = true;
    c.loadInfo(hash).then(
      (info) => {
        repairTitles(c, [{ ...tor, file_stats: info.file_stats }]);
        if (alive) setLoaded(info);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [c, hash, !!tor, own.length]);

  useEffect(() => {
    if (c) void refreshViewed(c);
  }, [c]);

  useEffect(() => {
    if (!c || !tor) return;
    let alive = true;
    loadWatch(c, hash).then(
      (v) => alive && setWatchNew(v),
      () => alive && setWatchNew(true),
    );
    return () => {
      alive = false;
    };
  }, [c, hash, !!tor]);

  useEffect(() => {
    if (!c || !tor) return;
    let alive = true;
    loadQualityWatch(c, hash).then(
      (v) => alive && setWatchQuality(v),
      () => alive && setWatchQuality(true),
    );
    return () => {
      alive = false;
    };
  }, [c, hash, !!tor]);

  useEffect(() => {
    if (!c || listed) return;
    let alive = true;
    setFetched(undefined);
    c.get(hash).then(
      (r) => alive && setFetched(r && r.hash ? r : null),
      () => alive && setFetched(null),
    );
    return () => {
      alive = false;
    };
  }, [c, hash, !!listed]);

  if (!c || !tor) {
    return (
      <div class="m-screen m-torrent" data-route="torrent">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} size={20} />
        </button>
        <p class="m-muted m-note">{c && fetched === undefined ? t('torrent.screen.loading') : t('torrent.screen.notFound')}</p>
      </div>
    );
  }

  const files = playableFiles(allFiles);
  const onOff = (v: boolean) => t(v ? 'tvSources.on' : 'tvSources.off');
  const toggleSkip = (key: 'i' | 'c') => {
    skip.save((p) => (key === 'i' ? { i: !p.i } : { c: !p.c }), true).then(undefined, (e) => showToast(errorMessage(e)));
  };
  const tv = activeTv.value;
  const title = displayTitle(tor);
  // a series of the catalogue with episode numbers: new episodes are looked for unless switched off here
  const series = isWatchedSeries({ hash: tor.hash, title, category: tor.category, data: '', file_stats: allFiles });
  const toggleWatchNew = () => {
    if (watchNew === null) return;
    const next = !watchNew;
    setWatchNew(next);
    saveWatch(c, tor, next).then(
      () => {
        // switched off: its «new episodes» card goes too
        if (!next) findingsOf(EPISODES_ID).forEach((f) => f.episodes && f.episodes.torrentHash === hash.toLowerCase() && removeFindings(EPISODES_ID, f.key));
        reloadMonitor();
      },
      (e) => {
        setWatchNew(!next);
        showToast(errorMessage(e));
      },
    );
  };
  // a film of the catalogue: better releases are looked for unless switched off here
  const film = isLibraryFilm({ title, category: tor.category });
  const toggleWatchQuality = () => {
    if (watchQuality === null) return;
    const next = !watchQuality;
    setWatchQuality(next);
    saveQualityWatch(c, tor, next).then(
      () => {
        // switched off: its «better quality» card goes too
        if (!next) findingsOf(BETTER_ID).forEach((f) => f.better && f.better.torrentHash === hash.toLowerCase() && removeFindings(BETTER_ID, f.key));
        reloadMonitor();
      },
      (e) => {
        setWatchQuality(!next);
        showToast(errorMessage(e));
      },
    );
  };
  const badges = [qualityBadge(title)].filter(Boolean);
  const first = files[0];
  const season = first ? parseEpisode(first.path).season : null;
  const hasEpisodes = files.length > 1;
  const peers = tor.total_peers || tor.active_peers || 0;
  const meta = [
    season !== null ? t('library.season', { n: season }) : '',
    hasEpisodes ? tp('library.episodes', files.length) : '',
    tor.torrent_size ? formatBytes(tor.torrent_size) : '',
    peers ? tp('torrent.screen.peerCount', peers) : '',
  ].filter(Boolean);

  // where to continue: the latest started file of this torrent, else the first one
  const target = watchTarget(hash, files);
  const at = target ? resumePosition(hash, target.id) : 0;
  const targetCode = target ? fileCode(target) : '';
  const mainLabel = at > 0
    ? t('torrent.screen.continueOnTv', { ep: targetCode ? targetCode + ' ' : '', time: formatDuration(at) })
    : t('news.watchOnTv') + (hasEpisodes && targetCode ? ' · ' + targetCode : '');

  const watchMain = async () => {
    if (!target) return;
    if (!tv) {
      navigate({ name: 'tv' });
      return;
    }
    await launch.start({
      hash,
      file: target.id,
      at,
      duration: getLocalProgress(hash, target.id)?.duration || undefined,
      label: [targetCode, fileTitle(target)].filter(Boolean).join(' · '),
      onBusy: setBusy,
      onError: setStatus,
    });
  };

  const watchPhone = async () => {
    if (!target) return;
    try {
      await actions.openExternal(streamUrlFor(c, tor, target), 'video/*');
      void recordPhoneWatch(c, hash, target.id, 0, getLocalProgress(hash, target.id)?.duration || 0);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  };

  const findPoster = () => {
    if (finding) return;
    setFinding(true);
    let found = '';
    findPosters(c, [tor], (_h, poster) => (found = poster)).then((r) => {
      setFinding(false);
      if (!r.hasKey) showToast(t('torrent.screen.needTmdbKey'));
      else if (!found) showToast(t('torrent.screen.posterNotFound'));
      else {
        showToast(t('torrent.screen.posterFound'));
        if (!listed && fetched) setFetched({ ...fetched, poster: found });
      }
    });
  };

  const rename = (raw: string) =>
    renameTorrent(c, tor, raw).then((saved) => {
      torrents.value = torrents.value.map((x) => (x.hash === hash ? { ...x, title: saved } : x));
      if (!listed && fetched) setFetched({ ...fetched, title: saved });
      showToast(t('torrent.screen.renamed'));
      void refreshTorrents(c).catch(() => {});
    });

  const remove = () => {
    if (!window.confirm(t('torrent.screen.deleteAsk', { title: shortTitle(title) }))) return;
    void deleteTorrents(c, [hash]).then((r) => {
      if (r.failed.length) {
        showToast(errorMessage(r.firstError));
        return;
      }
      const cur = currentRoute.value;
      if (cur.name === 'torrent' && cur.hash === hash) goBack();
    });
  };

  return (
    <div class="m-screen m-torrent" data-route="torrent">
      <div class="m-thead" style={posterStyle(tor) + '; --poster: ' + posterColor(hash)}>
        <div class="m-thead-bar">
          <button type="button" class="m-icon-btn m-glass" aria-label={t('common.back')} onClick={() => goBack()}>
            <Icon d={BACK} size={20} />
          </button>
          <div class="m-thead-actions">
            {!tor.poster && (
              <button type="button" class="m-icon-btn m-glass" aria-label={t('torrent.screen.findPoster')} disabled={finding} onClick={findPoster}>
                <Icon d={IMAGE} size={20} />
              </button>
            )}
            <button type="button" class="m-icon-btn m-glass" aria-label={t('torrent.rename.title')} onClick={() => setRenaming(true)}>
              <Icon d={PENCIL} size={20} />
            </button>
            <button type="button" class="m-icon-btn m-glass m-danger" aria-label={t('torrent.screen.deleteTorrent')} onClick={remove}>
              <Icon d={TRASH} size={20} />
            </button>
          </div>
        </div>
        <div class="m-thead-info">
          <div class="m-thead-title">{shortTitle(title)}</div>
          <div class="m-thead-meta">{meta.join(' · ')}</div>
          {badges.length > 0 && (
            <div class="m-badges">
              {badges.map((b) => (
                <span class="m-badge static" key={b}>
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div class="m-tbody">
        <button type="button" class="m-btn m-btn-primary" disabled={busy || !target} onClick={watchMain}>
          <Icon d={TV_PLAY} size={20} />
          {mainLabel}
        </button>
        <button type="button" class="m-btn m-btn-secondary m-btn-sm" disabled={!target} onClick={watchPhone}>
          <Icon d={PHONE} size={18} />
          {t('torrent.screen.watchOnPhone')}
        </button>
        {status && <LaunchError message={status} />}
        {files.length > 0 && (
          <div class="m-skip" data-block="skip">
            <button type="button" class="m-skip-row m-skip-open m-skip-toggle" aria-expanded={skipOpen} onClick={toggleSkipOpen}>
              <span class="m-skip-text">
                <span class="m-skip-title">{t('torrent.skip')}</span>
                <span class="m-muted m-small">
                  {t('torrent.screen.skipSumIntro', { state: onOff(skip.prefs.i) })} · {t('torrent.screen.skipSumCredits', { state: onOff(skip.prefs.c) })}
                </span>
              </span>
              <Icon d={skipOpen ? CHEVRON_UP : CHEVRON_DOWN} size={20} />
            </button>
            {skipOpen && (
              <>
                <div class="m-skip-row">
                  <span class="m-skip-text">{t('torrent.screen.skipIntroSwitch')}</span>
                  <SkipSwitch on={skip.prefs.i} label={t('torrent.screen.skipIntroSwitch')} onToggle={() => toggleSkip('i')} />
                </div>
                <div class="m-skip-row">
                  <span class="m-skip-text">{t('torrent.skipCreditsShort')}</span>
                  <SkipSwitch on={skip.prefs.c} label={t('torrent.skipCreditsShort')} onToggle={() => toggleSkip('c')} />
                </div>
                <button type="button" class="m-skip-row m-skip-open" onClick={() => setMarksOpen(true)}>
                  <span class="m-skip-text">
                    {t('tv.marks.title')}
                    <span class="m-muted m-small">{skipStatus(skip.hasChapters, skip.prefs)}</span>
                  </span>
                  <Icon d={CHEVRON} size={20} />
                </button>
              </>
            )}
          </div>
        )}
        {(series || film) && (
          <div class="m-skip" data-block="monitoring">
            <div class="m-skip-head">
              <span class="m-skip-title">{t('monitor.title')}</span>
            </div>
            {series && (
              <div class="m-skip-row" data-block="watch-new">
                <span class="m-skip-text">{t('monitor.settings.episodes')}</span>
                <SkipSwitch on={watchNew !== false} label={t('monitor.settings.episodes')} onToggle={toggleWatchNew} />
              </div>
            )}
            {film && (
              <div class="m-skip-row" data-block="watch-quality">
                <span class="m-skip-text">{t('torrent.screen.watchQuality')}</span>
                <SkipSwitch on={watchQuality !== false} label={t('torrent.screen.watchQuality')} onToggle={toggleWatchQuality} />
              </div>
            )}
          </div>
        )}
        {files.length > 0 && <div class="m-section">{hasEpisodes ? t('torrent.screen.episodesHead') : t('torrent.screen.filesHead')}</div>}
        <div class="m-list m-eps">
          {files.map((f, i) => {
            const pct = isWatched(hash, f.id) ? 100 : Math.round(progressRatio(hash, f.id) * 100);
            return (
              <button type="button" class="m-ep" key={f.id} onClick={() => setSheet(f)}>
                <span class="m-ep-code">{fileCode(f) || i + 1}</span>
                <span class="m-ep-text">
                  <span class="m-ep-name">{fileTitle(f)}</span>
                  <span class="m-bar-track thin">
                    <span class="m-bar-fill" style={{ width: pct + '%' }} />
                  </span>
                </span>
                <span class="m-muted m-small">{formatBytes(f.length)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {renaming && <TorrentRenameSheet initial={title} onSave={rename} onClose={() => setRenaming(false)} />}
      {marksOpen && <MarksSheet title={shortTitle(title)} prefs={skip.prefs} onSave={(p) => skip.save(p, false)} onClose={() => setMarksOpen(false)} />}
      {sheet && <WatchSheet torrent={tor} file={sheet} onClose={() => setSheet(null)} />}
      {launch.sheet}
    </div>
  );
}
