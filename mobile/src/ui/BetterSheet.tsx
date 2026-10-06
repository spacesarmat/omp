import { useEffect, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { showToast } from './toast';
import { t } from '../../../src/i18n';
import { navigate } from '../nav';
import { reloadMonitor } from '../monitor/ui';
import { phoneSourceContext } from '../searchContext';
import { client } from '../../../src/store/servers';
import { torrents, refreshTorrents } from '../../../src/store/library';
import { formatBytes } from '../../../src/lib/format';
import { shortTitle } from '../../../src/lib/libraryView';
import { displayTitle } from '../../../src/lib/torrentName';
import type { TorrentFile } from '../../../src/lib/episodes';
import { qualityLabel } from '../../../src/monitor/quality';
import { replaceAbort, replaceWithResult, type ReplaceAbort, type ReplaceResult } from '../../../src/monitor/replace';
import { findingsOf, removeFindings } from '../../../src/monitor/subs';
import { BETTER_ID, EPISODES_ID } from '../../../src/monitor/types';
import {
  carryProgress,
  findUpgrades,
  isLowSeeds,
  upgradeQuery,
  type UpgradeOutcome,
} from '../../../src/monitor/upgrade';
import { getSource } from '../../../src/sources/registry';
import { resultKey, seedsText, sourceName } from '../../../src/sources/view';
import type { SourceResult } from '../../../src/sources/types';
import type { LibraryTorrent } from '../../../src/monitor/newEpisodes';
import { coverageNote, failureOf, qualityOrUnknown, type Failure } from '../../../src/monitor/upgradeText';
import type { Torrent } from '../../../src/api/types';

export { failureOf };

const FILES_TIMEOUT_MS = 10000;
/** The longest the sheet waits for a replace before it gives up as a timeout. */
export const REPLACE_WAIT_MS = 45000;

function sameHash(a: string, b: string): boolean {
  return (a || '').toLowerCase() === (b || '').toLowerCase();
}

/** «18,2 ГБ · 940 сидов · rutor · сезоны 1–3». */
function rowMeta(lib: LibraryTorrent, r: SourceResult): string {
  return [r.Size, seedsText(r.Seed || 0), sourceName(r.source), coverageNote(lib, r)].filter(Boolean).join(' · ');
}

/** The cards of the monitoring findings about the replaced torrent go with it. */
function dropFindingsOf(hash: string): void {
  const h = hash.toLowerCase();
  findingsOf(BETTER_ID).forEach((f) => f.better && f.better.torrentHash === h && removeFindings(BETTER_ID, f.key));
  findingsOf(EPISODES_ID).forEach((f) => f.episodes && f.episodes.torrentHash === h && removeFindings(EPISODES_ID, f.key));
}

/**
 * «Найти в лучшем качестве»: searches now for releases of the same film / season in a better quality, lists them best
 * first (few seeds last, with a warning); «Заменить» confirms «1080p WEB-DL → 2160p Remux» and replaces the torrent in
 * place (history, skip settings, category and the phone's watch positions carry over). «Отмена» stops a running
 * replace and takes back the new torrent. A failure says why under the list, the torrent stays. Nothing better:
 * «Искать все раздачи» opens «Добавить».
 */
export function BetterSheet({
  torrent,
  files,
  onReplaced,
  onClose,
}: {
  torrent: Torrent;
  /** Every file of the torrent (the phone's watch positions are keyed by file index). */
  files: TorrentFile[];
  /** Called with the new torrent's hash after a successful replace (the sheet is closing). */
  onReplaced?: (hash: string) => void;
  onClose: () => void;
}) {
  const title = displayTitle(torrent);
  const lib: LibraryTorrent = { hash: torrent.hash, title: torrent.title || title, category: torrent.category, data: '', file_stats: files };
  const [outcome, setOutcome] = useState<UpgradeOutcome | null>(null);
  const [picked, setPicked] = useState<SourceResult | null>(null);
  const [running, setRunning] = useState<ReplaceAbort | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [alive] = useState({ v: true });
  const [search] = useState(() => findUpgrades(phoneSourceContext(), lib));
  const busy = !!running;

  useEffect(() => {
    alive.v = true;
    void search.done.then((o) => alive.v && setOutcome(o));
    return () => {
      alive.v = false;
      search.cancel();
    };
  }, []);

  const have = qualityOrUnknown(title);

  const searchAll = () => {
    const q = upgradeQuery(lib);
    onClose();
    navigate({ name: 'add', query: q, run: true });
  };

  const signIn = (id: string) => {
    const src = getSource(id);
    onClose();
    navigate(src && src.login ? { name: 'sourceSite', id } : { name: 'sources' });
  };

  const newFilesOf = (hash: string): Promise<TorrentFile[]> => {
    const listed = torrents.value.filter((x) => sameHash(x.hash, hash))[0];
    if (listed && listed.file_stats && listed.file_stats.length) return Promise.resolve(listed.file_stats);
    const c = client.value;
    if (!c) return Promise.resolve([]);
    // the replace has just loaded it, so this is quick; never hold the sheet for long over the positions
    return new Promise<TorrentFile[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), FILES_TIMEOUT_MS);
      c.loadInfo(hash).then(
        (i) => {
          clearTimeout(timer);
          resolve(i.file_stats || []);
        },
        () => {
          clearTimeout(timer);
          resolve([]);
        },
      );
    });
  };

  const replace = async (r: SourceResult) => {
    const c = client.value;
    if (!c) return setFailure({ text: t('errors.noServerSelected') });
    const ab = replaceAbort();
    setRunning(ab);
    setFailure(null);
    const res: ReplaceResult = await replaceWithResult(c, torrent.hash, r, phoneSourceContext(), {
      abort: ab,
      timeoutMs: REPLACE_WAIT_MS,
      deadlineMs: REPLACE_WAIT_MS,
    }).catch((): ReplaceResult => ({ ok: false, error: t('monitor.replace.failed') }));
    if (res.ok) {
      const fresh = await newFilesOf(res.hash);
      carryProgress(torrent.hash, files, res.hash, fresh);
      dropFindingsOf(torrent.hash);
      reloadMonitor();
      void refreshTorrents(c).catch(() => {});
      showToast(t('monitor.replaceSheet.replaced', { title: shortTitle(r.Title) }));
      onReplaced?.(res.hash);
      if (alive.v) onClose();
      return;
    }
    if (!alive.v) return;
    setRunning(null);
    // back to the list: another candidate can be picked
    setPicked(null);
    if (res.cause !== 'cancelled') setFailure(failureOf(res, r));
    if (res.cause === 'both') void refreshTorrents(c).catch(() => {});
  };

  // «Отмена»: a running replace stops waiting (the new torrent is taken back), else back to the list
  const cancel = () => {
    if (running) running.abort();
    else setPicked(null);
  };

  if (picked) {
    const oldSize = torrent.torrent_size ? formatBytes(torrent.torrent_size) : '';
    const covered = coverageNote(lib, picked);
    return (
      <Sheet label={t('monitor.replaceSheet.title')} onClose={cancel}>
        <div class="m-sheet-title">{t('monitor.replaceSheet.title')}</div>
        <div class="m-accent" data-block="better-change">
          {have + ' → ' + qualityOrUnknown(picked.Title)}
        </div>
        {isLowSeeds(picked) && (
          <div class="m-hint-warn" data-block="low-seeds">
            {t('torrent.better.lowSeedsWarn')}
          </div>
        )}
        <div class="m-rep-box">
          <div class="m-muted m-small">{t('monitor.replaceSheet.now')}</div>
          <div class="m-rep-line">{[shortTitle(title), oldSize].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="m-rep-arrow m-muted" aria-hidden="true">
          ↓
        </div>
        <div class="m-rep-box new">
          <div class="m-accent m-small">{[t('monitor.replaceSheet.fresh'), sourceName(picked.source), seedsText(picked.Seed || 0)].join(' · ')}</div>
          <div class="m-rep-line">{[shortTitle(picked.Title), picked.Size, covered].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="m-rep-moves">
          <div>✓ {t('monitor.replaceSheet.keepsHistory')}</div>
          <div>✓ {t('monitor.replaceSheet.keepsSkip')}</div>
          <div>✓ {t('monitor.replaceSheet.removesOld')}</div>
        </div>
        {busy && (
          <div class="m-muted m-small" role="status">
            {t('monitor.replaceSheet.busy')}
          </div>
        )}
        <div class="m-marks-actions">
          <button type="button" class="m-btn m-btn-secondary" data-action="cancel-replace" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={() => void replace(picked)}>
            {t('monitor.replaceSheet.replace')}
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet label={t('torrent.better.find')} onClose={onClose}>
      <div class="m-sheet-title">{t('torrent.better.find')}</div>
      <div class="m-muted m-small">{[shortTitle(title), t('torrent.better.have', { quality: have })].join(' · ')}</div>
      {failure && (
        <div class="m-error" role="alert" data-block="better-failure">
          <span>{failure.text}</span>
          {failure.source && (
            <button type="button" class="m-link-btn" onClick={() => signIn(failure.source!)}>
              {getSource(failure.source) && getSource(failure.source)!.login ? t('torrent.better.signIn') : t('torrent.better.openSources')}
            </button>
          )}
        </div>
      )}
      {!outcome && (
        <div class="m-better-wait" data-block="better-searching">
          <div class="m-muted" role="status">
            {t('torrent.better.searching')}
          </div>
          <button
            type="button"
            class="m-btn m-btn-secondary"
            onClick={() => {
              search.cancel();
              onClose();
            }}
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
      {outcome && !outcome.candidates.length && (
        <div class="m-better-empty" data-block="better-empty">
          <div class="m-muted">{outcome.answered ? t('torrent.better.none') : t('torrent.better.noAnswer')}</div>
          <button type="button" class="m-btn m-btn-secondary" onClick={searchAll}>
            {t('torrent.better.searchAll')}
          </button>
        </div>
      )}
      {outcome && outcome.candidates.length > 0 && (
        <div class="m-sheet-scroll m-better-list" data-block="better-list">
          {outcome.candidates.map((r) => {
            const chips = qualityLabel(r.Title).split(' ').filter(Boolean);
            const low = isLowSeeds(r);
            return (
              <div class="m-result m-result-card" key={resultKey(r)} data-better-row="">
                <div class="m-result-title" title={r.Title}>
                  {shortTitle(r.Title)}
                </div>
                {(chips.length > 0 || low) && (
                  <div class="m-badges">
                    {chips.map((b) => (
                      <span class="m-badge static" key={b}>
                        {b}
                      </span>
                    ))}
                    {low && (
                      <span class="m-badge static m-badge-warn" data-low-seeds="">
                        {t('torrent.better.lowSeeds')}
                      </span>
                    )}
                  </div>
                )}
                <div class="m-result-meta m-small">
                  <span class="m-muted">{rowMeta(lib, r)}</span>
                </div>
                <div class="m-result-actions">
                  <span class="m-grow" />
                  <button
                    type="button"
                    class="m-btn m-btn-primary m-btn-sm"
                    aria-label={t('torrent.better.replaceAria', { title: r.Title })}
                    onClick={() => {
                      setFailure(null);
                      setPicked(r);
                    }}
                  >
                    {t('monitor.replaceSheet.replace')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
