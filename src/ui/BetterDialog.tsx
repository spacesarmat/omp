// «В лучшем качестве» on the TV (torrent and series screens): searches the sources for a release of the same film or
// season in a better quality (LG: TorrServer rutor / Torznab; Android TV: every source), lists them best first, and OK
// on a row asks «Заменить» / «Добавить рядом» / «Отмена». «Заменить» replaces the torrent in place (history, skip
// settings, category and this TV's watch positions carry over); «Добавить рядом» adds the release and keeps the old one.
// Back closes the dialog (stopping the search) or stops a running replace. Keys under the dialog are blocked.
import { useEffect, useRef, useState } from 'preact/hooks';
import { doesFocusableExist, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Focusable, Button, Spinner } from './components';
import { useKeys } from './keys';
import { choose } from './dialog';
import { toast } from './toast';
import { navigate } from './nav';
import { tvGlyphs } from './tvText';
import { t } from '../i18n';
import { client } from '../store/servers';
import { torrents, refreshTorrents } from '../store/library';
import { errorMessage } from '../api/http';
import type { Torrent } from '../api/types';
import type { TorrentFile } from '../lib/episodes';
import { formatBytes } from '../lib/format';
import { shortTitle } from '../lib/libraryView';
import { displayTitle } from '../lib/torrentName';
import type { LibraryTorrent } from '../monitor/newEpisodes';
import { qualityLabel } from '../monitor/quality';
import { replaceAbort, replaceWithResult, type ReplaceAbort, type ReplaceResult } from '../monitor/replace';
import { carryProgress, findUpgrades, isLowSeeds, upgradeKind, upgradeQuery, type UpgradeOutcome } from '../monitor/upgrade';
import { coverageNote, failureOf, qualityOrUnknown } from '../monitor/upgradeText';
import { resolveLink, resultKey, seedsText, sourceName } from '../sources/view';
import { tvSourceContext } from '../sources/tvContext';
import type { SourceResult } from '../sources/types';

const FILES_TIMEOUT_MS = 10000;
/** The longest the dialog waits for a replace before it gives up as a timeout. */
export const TV_REPLACE_WAIT_MS = 45000;

/** The torrent as the upgrade search sees it. */
export function upgradeTarget(tor: Torrent, files: TorrentFile[]): LibraryTorrent {
  return { hash: tor.hash, title: tor.title || displayTitle(tor), category: tor.category, data: '', file_stats: files };
}

/** True when «В лучшем качестве» is offered for the torrent (a film, or a series with a known season). */
export function canUpgrade(tor: Torrent, files: TorrentFile[]): boolean {
  return upgradeKind(upgradeTarget(tor, files)) !== null;
}

function sameHash(a: string, b: string): boolean {
  return (a || '').toLowerCase() === (b || '').toLowerCase();
}

type BetterChoice = 'replace' | 'add' | 'cancel';

export function BetterDialog(p: {
  torrent: Torrent;
  /** Every file of the torrent (this TV's watch positions are keyed by file index). */
  files: TorrentFile[];
  /** After a successful replace, with the new torrent's hash; the parent closes the dialog. */
  onReplaced: (hash: string) => void;
  onClose: () => void;
}) {
  const title = displayTitle(p.torrent);
  const lib = upgradeTarget(p.torrent, p.files);
  const have = qualityOrUnknown(title);
  const [outcome, setOutcome] = useState<UpgradeOutcome | null>(null);
  const [failure, setFailure] = useState('');
  const [running, setRunning] = useState<ReplaceAbort | null>(null);
  const [adding, setAdding] = useState(false);
  const [search] = useState(() => findUpgrades(tvSourceContext(), lib));
  const alive = useRef(true);
  const busy = useRef(false);
  busy.current = !!running || adding;
  const runRef = useRef<ReplaceAbort | null>(null);
  runRef.current = running;

  useEffect(() => {
    const prev = getCurrentFocusKey() || '';
    setFocus('better-cancel');
    void search.done.then((o) => {
      if (!alive.current) return;
      setOutcome(o);
      setTimeout(() => {
        if (alive.current) setFocus(o.candidates.length ? 'better-row-0' : 'better-search-all');
      }, 0);
    });
    return () => {
      alive.current = false;
      search.cancel();
      if (runRef.current) runRef.current.abort();
      // back to the button that opened the dialog
      setTimeout(() => {
        if (prev && doesFocusableExist(prev)) setFocus(prev);
      }, 0);
    };
  }, []);

  const close = () => {
    if (runRef.current) {
      runRef.current.abort();
      return;
    }
    if (busy.current) return;
    search.cancel();
    p.onClose();
  };

  // above the screen, below DialogHost (the confirm choose() goes on top): Back closes, nothing reaches the screen
  useKeys((a) => {
    if (a === 'back') {
      close();
      return true;
    }
    return 'spatial';
  }, 50);

  const newFilesOf = (hash: string): Promise<TorrentFile[]> => {
    const c = client.value;
    const listed = torrents.value.filter((x) => sameHash(x.hash, hash))[0];
    if (listed && c && c.files(listed).length) return Promise.resolve(c.files(listed));
    if (!c) return Promise.resolve([]);
    return new Promise<TorrentFile[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), FILES_TIMEOUT_MS);
      c.loadInfo(hash).then(
        (i) => {
          clearTimeout(timer);
          resolve(c.files(i));
        },
        () => {
          clearTimeout(timer);
          resolve([]);
        },
      );
    });
  };

  const replace = (r: SourceResult) => {
    const c = client.value;
    if (!c) {
      setFailure(t('errors.noServerSelected'));
      return;
    }
    const ab = replaceAbort();
    setRunning(ab);
    runRef.current = ab;
    setFailure('');
    replaceWithResult(c, p.torrent.hash, r, tvSourceContext(), {
      abort: ab,
      timeoutMs: TV_REPLACE_WAIT_MS,
      deadlineMs: TV_REPLACE_WAIT_MS,
    })
      .catch((): ReplaceResult => ({ ok: false, error: t('monitor.replace.failed') }))
      .then((res) => {
        if (res.ok) {
          return newFilesOf(res.hash).then((fresh) => {
            carryProgress(p.torrent.hash, p.files, res.hash, fresh);
            runRef.current = null;
            void refreshTorrents(c).catch(() => undefined);
            toast(t('monitor.replaceSheet.replaced', { title: tvGlyphs(shortTitle(r.Title)) }));
            if (alive.current) setRunning(null);
            p.onReplaced(res.hash);
          });
        }
        runRef.current = null;
        if (res.cause === 'both') void refreshTorrents(c).catch(() => undefined);
        if (!alive.current) return;
        setRunning(null);
        if (res.cause !== 'cancelled') setFailure(tvGlyphs(failureOf(res, r).text));
      });
  };

  const addNear = (r: SourceResult) => {
    const c = client.value;
    if (!c) {
      setFailure(t('errors.noServerSelected'));
      return;
    }
    setAdding(true);
    setFailure('');
    resolveLink(r, tvSourceContext())
      .then((link) => c.add({ link, title: r.Title, category: p.torrent.category }))
      .then(
        (added) => {
          void refreshTorrents(c).catch(() => undefined);
          toast(t('add.added', { title: tvGlyphs(added.title || shortTitle(r.Title)) }));
          if (!alive.current) return;
          setAdding(false);
          p.onClose();
        },
        (e) => {
          if (!alive.current) return;
          setAdding(false);
          setFailure(tvGlyphs(errorMessage(e)));
        },
      );
  };

  const pick = (r: SourceResult) => {
    if (busy.current) return;
    const ask = t('tv.better.ask', { from: have, to: qualityOrUnknown(r.Title) });
    choose<BetterChoice>(isLowSeeds(r) ? ask + ' ' + t('torrent.better.lowSeedsWarn') : ask, [
      { label: t('monitor.replaceSheet.replace'), value: 'replace' },
      { label: t('tv.better.addNear'), value: 'add' },
      { label: t('common.cancel'), value: 'cancel' },
    ]).then((v) => {
      if (!alive.current) return;
      if (v === 'replace') replace(r);
      else if (v === 'add') addNear(r);
    });
  };

  const searchAll = () => {
    const q = upgradeQuery(lib);
    search.cancel();
    p.onClose();
    navigate({ name: 'add', query: q, run: true });
  };

  const size = p.torrent.torrent_size ? formatBytes(p.torrent.torrent_size) : '';
  const list = outcome ? outcome.candidates : [];
  return (
    <div
      class="dialog-backdrop better-backdrop"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        close();
      }}
    >
      <FocusGroup focusKey="BETTER-DIALOG" className="dialog better-dialog" boundary>
        <div class="dialog-title better-title">{t('tv.better.title')}</div>
        <div class="better-current">
          {tvGlyphs(shortTitle(title)) + ' · ' + t('tv.better.current') + ' '}
          <b>{[have, size].filter(Boolean).join(' · ')}</b>
        </div>
        {failure && <div class="banner-error better-failure" role="alert">{failure}</div>}
        {!outcome && (
          <div class="better-wait">
            <Spinner text={t('torrent.better.searching')} />
            <Button focusKey="better-cancel" label={t('common.cancel')} onPress={close} />
          </div>
        )}
        {outcome && !list.length && (
          <div class="better-empty">
            <div class="muted">{outcome.answered ? t('torrent.better.none') : t('torrent.better.noAnswer')}</div>
            <Button focusKey="better-search-all" label={t('torrent.better.searchAll')} onPress={searchAll} />
          </div>
        )}
        {list.length > 0 && (
          <div class="better-list">
            {list.map((r, i) => {
              const chips = qualityLabel(r.Title).split(' ').filter(Boolean);
              const low = isLowSeeds(r);
              const meta = [r.Size, seedsText(r.Seed || 0), sourceName(r.source), coverageNote(lib, r)].filter(Boolean).join(' · ');
              return (
                <Focusable
                  key={resultKey(r)}
                  focusKey={'better-row-' + i}
                  className="better-row"
                  role="button"
                  ariaLabel={t('torrent.better.replaceAria', { title: tvGlyphs(r.Title) })}
                  onPress={() => pick(r)}
                >
                  <div class="better-main">
                    <div class="better-tags">
                      {chips.map((c) => (
                        <span key={c} class={'better-tag' + (have.indexOf(c) < 0 ? ' hot' : '')}>
                          {c}
                        </span>
                      ))}
                      {low && <span class="better-tag warn">{t('torrent.better.lowSeeds')}</span>}
                    </div>
                    <div class="better-name">{tvGlyphs(r.Title)}</div>
                  </div>
                  <div class="better-meta">{tvGlyphs(meta)}</div>
                </Focusable>
              );
            })}
          </div>
        )}
        {running && (
          <div class="muted better-busy" role="status">
            {t('monitor.replaceSheet.busy')}
          </div>
        )}
        <div class="better-follow" aria-disabled="true">
          <span class="better-follow-label">{t('tv.better.follow')}</span>
          <span class="muted better-follow-note">{t('tv.better.followPhone')}</span>
          <span class="skip-switch better-follow-switch" role="switch" aria-checked={false} aria-disabled="true" />
        </div>
        <div class="better-note muted">{t('tv.better.note')}</div>
        <div class="better-hints muted">{t('tv.better.hintOk') + ' · ' + t('tv.better.hintBack')}</div>
      </FocusGroup>
    </div>
  );
}
