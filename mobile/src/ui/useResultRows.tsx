// Rows of found releases outside «Добавить» (the «Новое» feed, subscription findings): the same card and the same add
// path, with the category sheet and the TV launch.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { Sheet } from './Sheet';
import { ResultCard } from './ResultCard';
import { showToast } from './toast';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { useTvLaunch } from '../watch';
import { addSearchResult, type RowBusy } from '../addResult';
import { errorMessage } from '../../../src/api/http';
import { addCategories, guessCategory } from '../../../src/lib/categoryGuess';
import { resultKey } from '../../../src/sources/view';
import type { SourceResult } from '../../../src/sources/types';
import { t } from '../../../src/i18n';

export interface ResultRows {
  card(r: SourceResult, o?: { flag?: string; highlight?: boolean; onAdded?: () => void }): VNode;
  /** «Добавить» (watch false) or «На ТВ»; `onAdded` runs after a successful add. */
  add(r: SourceResult, watch: boolean, onAdded?: () => void): Promise<void>;
  /** Plays a torrent already on the server on the TV (after a replace). */
  watch(hash: string, label: string): Promise<void>;
  /** The category sheet and the launch dialogs. */
  sheets: VNode;
  error: string;
}

export function useResultRows(o?: { category?: (r: SourceResult) => string }): ResultRows {
  const [pending, setPending] = useState<Record<string, RowBusy>>({});
  const pendingRef = useRef<Record<string, RowBusy>>({});
  const [rowCat, setRowCat] = useState<Record<string, string>>({});
  const [catFor, setCatFor] = useState<SourceResult | null>(null);
  const [error, setError] = useState('');
  const [alive] = useState({ v: true });
  const launch = useTvLaunch();
  useEffect(
    () => () => {
      alive.v = false;
    },
    [],
  );

  const categoryOf = (r: SourceResult): string => {
    const v = rowCat[resultKey(r)];
    if (v !== undefined) return v;
    return o && o.category ? o.category(r) : guessCategory(r.Title);
  };

  const mark = (key: string, s: RowBusy | null) => {
    const next = { ...pendingRef.current };
    if (s) next[key] = s;
    else delete next[key];
    pendingRef.current = next;
    if (alive.v) setPending(next);
  };

  const add = async (r: SourceResult, watch: boolean, onAdded?: () => void) => {
    const key = resultKey(r);
    if (pendingRef.current[key]) return;
    if (watch && !activeTv.value) {
      navigate({ name: 'tv' });
      return;
    }
    setError('');
    try {
      const hash = await addSearchResult(r, categoryOf(r), { onStep: (s) => mark(key, s), alive: () => alive.v });
      if (!hash || !alive.v) return;
      onAdded?.();
      if (!watch) {
        showToast(t('notify.added'));
        return;
      }
      await launch.start({
        hash,
        label: r.Title,
        onError: setError,
        onLaunched: (name) => showToast(t('add.launchedOn', { name })),
      });
    } catch (e) {
      if (alive.v) setError(errorMessage(e));
    } finally {
      mark(key, null);
    }
  };

  const watch = async (hash: string, label: string) => {
    if (!activeTv.value) {
      navigate({ name: 'tv' });
      return;
    }
    setError('');
    await launch.start({ hash, label, onError: setError, onLaunched: (name) => showToast(t('add.launchedOn', { name })) });
  };

  const card = (r: SourceResult, c?: { flag?: string; highlight?: boolean; onAdded?: () => void }) => (
    <ResultCard
      key={resultKey(r)}
      r={r}
      category={categoryOf(r)}
      busy={pending[resultKey(r)]}
      flag={c?.flag}
      highlight={c?.highlight}
      onCategory={() => setCatFor(r)}
      onAdd={() => void add(r, false, c?.onAdded)}
      onWatch={() => void add(r, true, c?.onAdded)}
    />
  );

  const current = catFor ? categoryOf(catFor) : '';
  const sheets = (
    <>
      {catFor && (
        <Sheet label={t('add.category')} onClose={() => setCatFor(null)}>
          <div class="m-sheet-title">{t('add.category')}</div>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            {addCategories().map((c) => (
              <button
                key={c.id}
                type="button"
                class={'m-chip' + (current === c.id ? ' on' : '')}
                aria-pressed={current === c.id}
                onClick={() => {
                  setRowCat({ ...rowCat, [resultKey(catFor)]: c.id });
                  setCatFor(null);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {launch.sheet}
    </>
  );

  return { card, add, watch, sheets, error };
}
