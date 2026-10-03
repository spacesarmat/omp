import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { qualityBadge, posterStyle } from '../ui/Poster';
import { showToast } from '../ui/toast';
import { LaunchError } from '../ui/LaunchError';
import { currentRoute, goBack, navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { actions, filesOf, recordPhoneWatch, streamUrlFor, tvServerUrl, useTvLaunch } from '../watch';
import { client, activeServer } from '../../../src/store/servers';
import { torrents, refreshTorrents, findPosters } from '../../../src/store/library';
import {
  continueWatching,
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
import { loadWatch, saveWatch } from '../../../src/store/journal';
import { isWatchedSeries } from '../../../src/monitor/newEpisodes';
import { findingsOf, pruneEpisodeFindings, removeFindings } from '../../../src/monitor/subs';
import { EPISODES_ID } from '../../../src/monitor/types';
import { reloadMonitor } from '../monitor/ui';

const BACK = 'M15 5l-7 7 7 7';
const IMAGE = 'M4 5h16v14H4zM4 16l4.5-4.5 4 4 3-3L20 17M15.5 9.5h.01';
const TRASH = 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3';
const TV = 'M3 5h18v11H3zM8 20h8';
const TV_PLAY = 'M3 5h18v11H3zM8 20h8M10 8.5l4 2.5-4 2.5z';
const PHONE = 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2';
const LINK = 'M9 15l6-6M10 6l1.5-1.5a5 5 0 0 1 7 7L17 13M14 18l-1.5 1.5a5 5 0 0 1-7-7L7 11';
const CHECK = 'M5 12.5l4.5 4.5L19 7';
const CHEVRON = 'M9 6l6 6-6 6';

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

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
      onLaunched: (name) => setStatus({ kind: 'ok', text: 'Запустил на ' + name }),
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
      showToast(withAuth && hasAuth ? 'Ссылка скопирована (с логином и паролем)' : 'Ссылка скопирована');
      if (alive.v) onClose();
    } catch (e) {
      if (alive.v) setStatus({ kind: 'error', text: errorMessage(e) });
    }
  };

  return (
    <Sheet onClose={onClose} label="Где смотреть">
      <div class="m-muted m-small">{head.join(' · ')}</div>
      <div class="m-sheet-title">Где смотреть?</div>
      <button type="button" class="m-opt primary" disabled={busy} onClick={onTv}>
        <Icon d={TV} size={26} />
        <span class="m-opt-text">
          <span class="m-opt-name">{tv ? 'На телевизоре ' + tv.name : 'На телевизоре'}</span>
          <span class="m-opt-sub">{tv ? 'Откроется OMP и начнётся просмотр' : 'Сначала подключите телевизор'}</span>
        </span>
      </button>
      <button type="button" class="m-opt" onClick={onPhone}>
        <Icon d={PHONE} size={26} />
        <span class="m-opt-text">
          <span class="m-opt-name">На телефоне</span>
          <span class="m-opt-sub">В VLC, MX Player или другом плеере</span>
        </span>
      </button>
      <button type="button" class="m-opt" onClick={() => onCopy(true)}>
        <Icon d={LINK} size={26} />
        <span class="m-opt-text">
          <span class="m-opt-name">Скопировать ссылку на поток</span>
          <span class="m-opt-sub">
            {hasAuth ? 'Ссылка содержит логин и пароль сервера' : 'Для другого устройства в этой сети'}
          </span>
        </span>
      </button>
      {hasAuth && (
        <button type="button" class="m-opt" onClick={() => onCopy(false)}>
          <Icon d={LINK} size={26} />
          <span class="m-opt-text">
            <span class="m-opt-name">Скопировать без пароля</span>
            <span class="m-opt-sub">Плеер на другом устройстве спросит логин</span>
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
const BAD_TIME = 'Введите время как мин:сек, например 1:30';

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
    const t = to.trim();
    const l = last.trim();
    let mi: [number, number] | null = null;
    let mc: number | null = null;
    if (f || t) {
      const a = parseMark(f);
      const b = parseMark(t);
      if (a === null || b === null) return setError(BAD_TIME);
      if (b <= a) return setError('Конец заставки должен быть позже начала');
      mi = [a, b];
    }
    if (l) {
      const m = parseMark(l);
      if (m === null || m <= 0) return setError(BAD_TIME);
      mc = m;
    }
    setError('');
    write({ mi, mc });
  };

  return (
    <Sheet onClose={onClose} label="Заставка и титры">
      <div class="m-sheet-title">Заставка и титры</div>
      <div class="m-muted m-small">Для всех серий «{title}». Если в файле есть главы «Заставка» или «Титры» — используются они.</div>
      <div class="m-section">Заставка</div>
      <div class="m-marks-pair">
        <div class="m-field">
          <label for="m-mark-from">С</label>
          <input id="m-mark-from" class="m-input" type="text" inputMode="numeric" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
        </div>
        <div class="m-field">
          <label for="m-mark-to">До</label>
          <input id="m-mark-to" class="m-input" type="text" inputMode="numeric" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
        </div>
      </div>
      <div class="m-section">Титры</div>
      <div class="m-field">
        <label for="m-mark-last">Последние (мин:сек)</label>
        <input id="m-mark-last" class="m-input" type="text" inputMode="numeric" value={last} onInput={(e) => setLast((e.target as HTMLInputElement).value)} />
      </div>
      <div class="m-muted m-small">Удобнее отметить прямо в плеере: меню → «Отметить начало заставки».</div>
      {error && (
        <div class="m-error" role="alert">
          {error}
        </div>
      )}
      <div class="m-marks-actions">
        <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={() => write({ mi: null, mc: null })}>
          Сбросить
        </button>
        <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={save}>
          Сохранить
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
  const t = listed || fetched || undefined;
  const [loaded, setLoaded] = useState<TorrentT | null>(null);
  const [sheet, setSheet] = useState<TorrentFile | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const launch = useTvLaunch();
  const [marksOpen, setMarksOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  // «Следить за новыми сериями» (omp.w in the journal); null until read from the server
  const [watchNew, setWatchNew] = useState<boolean | null>(null);
  progressVersion.value;
  serverViewed.value;

  const own = t ? filesOf(t) : [];
  const allFiles = own.length ? own : loaded ? filesOf(loaded) : [];
  const skip = useSkip(c, hash, firstPlayableId(allFiles), !!t);
  // file list comes from the list entry; load it from the server if the entry has none
  useEffect(() => {
    if (!c || !t || own.length) return;
    let alive = true;
    c.loadInfo(hash).then(
      (info) => alive && setLoaded(info),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [c, hash, !!t, own.length]);

  useEffect(() => {
    if (c) void refreshViewed(c);
  }, [c]);

  useEffect(() => {
    if (!c || !t) return;
    let alive = true;
    loadWatch(c, hash).then(
      (v) => alive && setWatchNew(v),
      () => alive && setWatchNew(true),
    );
    return () => {
      alive = false;
    };
  }, [c, hash, !!t]);

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

  if (!c || !t) {
    return (
      <div class="m-screen m-torrent" data-route="torrent">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d={BACK} size={20} />
        </button>
        <p class="m-muted m-note">{c && fetched === undefined ? 'Загружаю…' : 'Раздача не найдена'}</p>
      </div>
    );
  }

  const files = playableFiles(allFiles);
  const toggleSkip = (key: 'i' | 'c') => {
    skip.save((p) => (key === 'i' ? { i: !p.i } : { c: !p.c }), true).then(undefined, (e) => showToast(errorMessage(e)));
  };
  const tv = activeTv.value;
  const title = t.title || t.name || t.hash;
  // a series of the catalogue with episode numbers: new episodes are looked for unless switched off here
  const series = isWatchedSeries({ hash: t.hash, title, category: t.category, data: '', file_stats: allFiles });
  const toggleWatchNew = () => {
    if (watchNew === null) return;
    const next = !watchNew;
    setWatchNew(next);
    saveWatch(c, t, next).then(
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
  const badges = [qualityBadge(title)].filter(Boolean);
  const first = files[0];
  const season = first ? parseEpisode(first.path).season : null;
  const hasEpisodes = files.length > 1;
  const peers = t.total_peers || t.active_peers || 0;
  const meta = [
    season !== null ? 'Сезон ' + season : '',
    hasEpisodes ? files.length + ' ' + plural(files.length, 'серия', 'серии', 'серий') : '',
    t.torrent_size ? formatBytes(t.torrent_size) : '',
    peers ? peers + ' ' + plural(peers, 'пир', 'пира', 'пиров') : '',
  ].filter(Boolean);

  // where to continue: the latest started file of this torrent, else the first one
  const last = continueWatching(torrents.value, 1000).find((e) => e.torrent.hash === hash);
  const target = (last && files.find((f) => f.id === last.fileIndex)) || first;
  const at = target ? resumePosition(hash, target.id) : 0;
  const targetCode = target ? fileCode(target) : '';
  const mainLabel = at > 0
    ? 'Продолжить на ТВ · ' + (targetCode ? targetCode + ' ' : '') + 'с ' + formatDuration(at)
    : 'Смотреть на ТВ' + (hasEpisodes && targetCode ? ' · ' + targetCode : '');

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
      await actions.openExternal(streamUrlFor(c, t, target), 'video/*');
      void recordPhoneWatch(c, hash, target.id, 0, getLocalProgress(hash, target.id)?.duration || 0);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  };

  const findPoster = () => {
    if (finding) return;
    setFinding(true);
    let found = '';
    findPosters(c, [t], (_h, poster) => (found = poster)).then((r) => {
      setFinding(false);
      if (!r.hasKey) showToast('Задайте ключ TMDB в «Настройках сервера»');
      else if (!found) showToast('Обложка не найдена');
      else {
        showToast('Обложка найдена');
        if (!listed && fetched) setFetched({ ...fetched, poster: found });
      }
    });
  };

  const remove = () => {
    if (!window.confirm('Удалить раздачу «' + shortTitle(title) + '»?')) return;
    c.remove(hash).then(
      () => {
        torrents.value = torrents.value.filter((x) => x.hash !== hash);
        // its «Новые серии» card can't be replaced any more
        pruneEpisodeFindings((h) => h.toLowerCase() !== hash.toLowerCase());
        reloadMonitor();
        void refreshTorrents(c).catch(() => {});
        const r = currentRoute.value;
        if (r.name === 'torrent' && r.hash === hash) goBack();
      },
      (e) => showToast(errorMessage(e)),
    );
  };

  return (
    <div class="m-screen m-torrent" data-route="torrent">
      <div class="m-thead" style={posterStyle(t) + '; --poster: ' + posterColor(hash)}>
        <div class="m-thead-bar">
          <button type="button" class="m-icon-btn m-glass" aria-label="Назад" onClick={() => goBack()}>
            <Icon d={BACK} size={20} />
          </button>
          <div class="m-thead-actions">
            {!t.poster && (
              <button type="button" class="m-icon-btn m-glass" aria-label="Найти обложку" disabled={finding} onClick={findPoster}>
                <Icon d={IMAGE} size={20} />
              </button>
            )}
            <button type="button" class="m-icon-btn m-glass m-danger" aria-label="Удалить раздачу" onClick={remove}>
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
          Смотреть на телефоне
        </button>
        {status && <LaunchError message={status} />}
        {files.length > 0 && (
          <div class="m-skip">
            <div class="m-skip-head">
              <span class="m-skip-title">Пропуск</span>
              <span class="m-muted m-small">для всех серий · ТВ и телефон</span>
            </div>
            <div class="m-skip-row">
              <span class="m-skip-text">Пропускать заставку</span>
              <SkipSwitch on={skip.prefs.i} label="Пропускать заставку" onToggle={() => toggleSkip('i')} />
            </div>
            <div class="m-skip-row">
              <span class="m-skip-text">
                Пропускать титры
                <span class="m-muted m-small">сразу следующая серия</span>
              </span>
              <SkipSwitch on={skip.prefs.c} label="Пропускать титры" onToggle={() => toggleSkip('c')} />
            </div>
            <button type="button" class="m-skip-row m-skip-open" onClick={() => setMarksOpen(true)}>
              <span class="m-skip-text">
                Заставка и титры
                <span class="m-muted m-small">{skipStatus(skip.hasChapters, skip.prefs)}</span>
              </span>
              <Icon d={CHEVRON} size={20} />
            </button>
          </div>
        )}
        {series && (
          <div class="m-skip" data-block="watch-new">
            <div class="m-skip-row">
              <span class="m-skip-text">
                Следить за новыми сериями
                <span class="m-muted m-small">сообщить, когда выйдут следующие серии</span>
              </span>
              <SkipSwitch on={watchNew !== false} label="Следить за новыми сериями" onToggle={toggleWatchNew} />
            </div>
          </div>
        )}
        {files.length > 0 && <div class="m-section">{hasEpisodes ? 'Серии' : 'Файлы'}</div>}
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
      {marksOpen && <MarksSheet title={shortTitle(title)} prefs={skip.prefs} onSave={(p) => skip.save(p, false)} onClose={() => setMarksOpen(false)} />}
      {sheet && <WatchSheet torrent={t} file={sheet} onClose={() => setSheet(null)} />}
      {launch.sheet}
    </div>
  );
}
