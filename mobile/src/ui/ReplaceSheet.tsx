import { useEffect, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { showToast } from './toast';
import { qualityBadge } from './Poster';
import { rangeText } from '../monitor/text';
import { t, tp } from '../../../src/i18n';
import { reloadMonitor } from '../monitor/ui';
import { phoneSourceContext } from '../searchContext';
import { client } from '../../../src/store/servers';
import { torrents, refreshTorrents } from '../../../src/store/library';
import { formatBytes } from '../../../src/lib/format';
import { shortTitle } from '../../../src/lib/libraryView';
import { findBetter } from '../../../src/monitor/better';
import { findNewEpisodes } from '../../../src/monitor/newEpisodes';
import { replaceWithResult, type ReplaceResult } from '../../../src/monitor/replace';
import { removeFindings } from '../../../src/monitor/subs';
import type { Finding } from '../../../src/monitor/types';
import { resultKey, seedsText, sourceName } from '../../../src/sources/view';
import type { SourceResult } from '../../../src/sources/types';
import type { Torrent } from '../../../src/api/types';
import { displayTitle } from '../../../src/lib/torrentName';

const CHECK = 'M5 12l5 5l9-10';

function sameHash(a: string, b: string): boolean {
  return (a || '').toLowerCase() === (b || '').toLowerCase();
}

/** «Серии 1–8 из 10 · 1080p · 14,1 ГБ». */
function releaseLine(title: string, size: string): string {
  return [rangeText(title), qualityBadge(title), size].filter(Boolean).join(' · ') || title;
}

/** The library torrent a finding is about: a series with new episodes or a film in better quality. */
function libraryHashOf(f: Finding): string {
  return f.episodes ? f.episodes.torrentHash : f.better ? f.better.torrentHash : '';
}

/** Library torrent of a new-episodes or better-quality finding, when the library list has it. */
export function libraryTorrentOf(f: Finding): Torrent | null {
  const hash = libraryHashOf(f);
  return torrents.value.filter((t) => sameHash(t.hash, hash))[0] || null;
}

/**
 * «Заменить раздачу»: the library torrent against the new release, what is carried over, «Другая раздача» (other newer
 * or better releases, searched when the sheet opens), then the replace (the old torrent stays when anything fails).
 */
export function ReplaceSheet({
  finding,
  thenWatch,
  onReplaced,
  onClose,
}: {
  finding: Finding;
  /** «Смотреть на ТВ»: the button says «Заменить и смотреть»; onReplaced then launches the new torrent. */
  thenWatch?: boolean;
  /** Called with the new torrent after a successful replace (before the sheet closes). */
  onReplaced?: (hash: string, title: string) => void;
  onClose: () => void;
}) {
  const e = finding.episodes;
  const hash = libraryHashOf(finding);
  const torrentTitle = e ? e.torrentTitle : finding.better ? finding.better.torrentTitle : '';
  const old = libraryTorrentOf(finding);
  const [picked, setPicked] = useState<SourceResult>(finding.result);
  const [others, setOthers] = useState<SourceResult[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [alive] = useState({ v: true });

  useEffect(() => {
    alive.v = true;
    setOthers(null);
    if (old) {
      const more: Promise<SourceResult[]> = e
        ? findNewEpisodes(phoneSourceContext(), old).then((n) => (n ? [n.candidate].concat(n.others) : []))
        : findBetter(phoneSourceContext(), old).then((b) => (b ? [b.candidate].concat(b.others) : []));
      void more.then((list) => {
        if (!alive.v) return;
        const key = resultKey(finding.result);
        setOthers(list.filter((r) => resultKey(r) !== key));
      });
    } else setOthers([]);
    return () => {
      alive.v = false;
    };
  }, [old ? old.hash : '']);

  const name = shortTitle(torrentTitle || (old ? displayTitle(old) : ''));
  const oldTitle = old ? displayTitle(old) || torrentTitle : torrentTitle;
  const oldSize = old && old.torrent_size ? formatBytes(old.torrent_size) : '';

  const replace = async () => {
    const c = client.value;
    if (!c) return setError(t('errors.noServerSelected'));
    if (!old) {
      // not in the loaded list: ask the server; when it is really gone there is nothing to replace, the card goes
      setBusy(true);
      setError('');
      const all = await c.list().catch((): Torrent[] | null => null);
      if (!alive.v) return;
      setBusy(false);
      if (!all) return setError(t('monitor.replaceSheet.noList'));
      if (all.some((t) => sameHash(t.hash, hash))) {
        void refreshTorrents(c).catch(() => {});
        return setError(t('monitor.replaceSheet.loading'));
      }
      removeFindings(finding.subId, finding.key);
      reloadMonitor();
      showToast(t('monitor.replaceSheet.gone'));
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    const r: ReplaceResult = await replaceWithResult(c, old.hash, picked, phoneSourceContext()).catch(
      (): ReplaceResult => ({ ok: false, error: t('monitor.replace.failed') }),
    );
    if (r.ok) {
      removeFindings(finding.subId, finding.key);
      reloadMonitor();
      void refreshTorrents(c).catch(() => {});
      showToast(t('monitor.replaceSheet.replaced', { title: shortTitle(picked.Title) }));
      onReplaced?.(r.hash, picked.Title);
      if (alive.v) onClose();
      return;
    }
    if (!alive.v) return;
    setBusy(false);
    setError(r.error);
  };

  if (choosing) {
    const list = [finding.result].concat((others || []).filter((r) => resultKey(r) !== resultKey(finding.result)));
    return (
      <Sheet label={t('monitor.replaceSheet.other')} onClose={() => setChoosing(false)}>
        <div class="m-sheet-title">{t('monitor.replaceSheet.other')}</div>
        <div class="m-sheet-scroll m-sub-pick" role="radiogroup" aria-label={t('monitor.replaceSheet.other')}>
          {list.map((r) => {
            const on = resultKey(r) === resultKey(picked);
            return (
              <button
                key={resultKey(r)}
                type="button"
                role="radio"
                aria-checked={on}
                class="m-opt"
                onClick={() => {
                  setPicked(r);
                  setChoosing(false);
                }}
              >
                <span class="m-opt-text m-grow">
                  <span class="m-opt-name">{r.Title}</span>
                  <span class="m-opt-sub">{[sourceName(r.source), r.Size, seedsText(r.Seed || 0)].filter(Boolean).join(' · ')}</span>
                </span>
                {on && <Icon d={CHECK} size={20} />}
              </button>
            );
          })}
        </div>
      </Sheet>
    );
  }

  const more = others === null ? t('monitor.replaceSheet.searching') : others.length ? tp('monitor.replaceSheet.moreN', others.length) + ' ›' : t('monitor.replaceSheet.noOthers');
  return (
    <Sheet label={t('monitor.replaceSheet.title')} onClose={() => !busy && onClose()}>
      <div class="m-sheet-title">{thenWatch ? t('monitor.replaceSheet.titleWatch') : t('monitor.replaceSheet.title')}</div>
      {thenWatch && <div class="m-muted m-small">{t('monitor.replaceSheet.watchNote')}</div>}
      <div class="m-muted m-small">{e ? name + ' · ' + t('library.season', { n: e.season }) : name}</div>
      <div class="m-rep-box">
        <div class="m-muted m-small">{t('monitor.replaceSheet.now')}</div>
        <div class="m-rep-line">{releaseLine(oldTitle, oldSize)}</div>
      </div>
      <div class="m-rep-arrow m-muted" aria-hidden="true">
        ↓
      </div>
      <div class="m-rep-box new">
        <div class="m-accent m-small">{[t('monitor.replaceSheet.fresh'), sourceName(picked.source), seedsText(picked.Seed || 0)].join(' · ')}</div>
        <div class="m-rep-line">{releaseLine(picked.Title, picked.Size)}</div>
      </div>
      <div class="m-rep-moves">
        <div>✓ {t('monitor.replaceSheet.keepsHistory')}</div>
        <div>✓ {t('monitor.replaceSheet.keepsSkip')}</div>
        <div>✓ {t('monitor.replaceSheet.removesOld')}</div>
      </div>
      <button
        type="button"
        class="m-set-row m-set-pick"
        aria-haspopup="dialog"
        disabled={busy || !others || !others.length}
        onClick={() => setChoosing(true)}
      >
        <span>{t('monitor.replaceSheet.other')}</span>
        <span class="m-muted">{more}</span>
      </button>
      {busy && (
        <div class="m-muted m-small" role="status">
          {t('monitor.replaceSheet.busy')}
        </div>
      )}
      {error && (
        <div class="m-error" role="alert">
          {error}
        </div>
      )}
      <div class="m-marks-actions">
        <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={() => void replace()}>
          {thenWatch ? t('monitor.replaceSheet.titleWatch') : t('monitor.replaceSheet.replace')}
        </button>
      </div>
    </Sheet>
  );
}
