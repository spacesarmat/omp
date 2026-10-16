// Audiobook search: the same sources as «Добавить», with searchMode 'audiobook'.
// A book added here is filed as an audiobook, so it shows up in «Мои книги».
import { useEffect, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../../../src/api/http';
import { filterByKind } from '../../../src/lib/releaseKind';
import { t } from '../../../src/i18n';
import { searchAll, type SearchHandle } from '../../../src/sources/search';
import { onSearchFailure, type CheckedHosts } from '../../../src/sources/cloudflareCheck';
import { progressText, resultKey, sortResults, sourceName, stableOrder } from '../../../src/sources/view';
import type { SourceResult } from '../../../src/sources/types';
import { client } from '../../../src/store/servers';
import { activeTv } from '../tv/tvStore';
import { useTvLaunch } from '../watch';
import { navigate } from '../nav';
import { phoneSourceContext } from '../searchContext';
import { addSearchResult, type RowBusy } from '../addResult';
import { showToast } from '../ui/toast';
import { LaunchError } from '../ui/LaunchError';
import { ResultCard } from '../ui/ResultCard';
import { Icon } from '../ui/Icon';
import { AudiobookBar } from './bar';

const SEARCH = 'M5 11a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M20 20l-4.5-4.5';

interface Prog {
  answered: number;
  total: number;
  pending: string[];
  failed: string[];
}

function progOf(h: SearchHandle): Prog {
  return { answered: h.answered().length, total: h.sourceIds.length, pending: h.pending(), failed: h.failed() };
}

export function AudiobookSearch() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SourceResult[] | null>(null);
  const [prog, setProg] = useState<Prog | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [rowCat, setRowCat] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, RowBusy>>({});
  const [alive] = useState({ v: true });
  const pendingRef = useRef<Map<string, RowBusy>>(new Map());
  const handleRef = useRef<SearchHandle | null>(null);
  const orderRef = useRef<string[]>([]);
  const launch = useTvLaunch();
  const tv = activeTv.value;

  useEffect(
    () => () => {
      alive.v = false;
      if (handleRef.current) handleRef.current.cancel();
    },
    [],
  );

  const sync = (h: SearchHandle) => {
    if (!alive.v || handleRef.current !== h) return;
    setRows(h.results());
    setProg(progOf(h));
    setSearching(h.pending().length > 0);
  };

  const runSearch = (q: string, asked: CheckedHosts) => {
    if (handleRef.current) handleRef.current.cancel();
    orderRef.current = [];
    setError('');
    const notify = () => {
      if (alive.v && handleRef.current === h) sync(h);
    };
    const ctx = phoneSourceContext();
    ctx.searchMode = 'audiobook';
    const h: SearchHandle = searchAll(q, {
      ctx,
      onResult: notify,
      onDone: (id, err) => {
        notify();
        if (err) onSearchFailure(id, err, asked, () => {
          if (handleRef.current === h) runSearch(q, asked);
        });
      },
    });
    handleRef.current = h;
    sync(h);
  };

  const onSearch = (e?: Event) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    const focused = document.activeElement as HTMLElement | null;
    if (focused && focused.tagName === 'INPUT') focused.blur();
    runSearch(q, {});
  };

  const markRow = (key: string, state: RowBusy | null) => {
    if (state) pendingRef.current.set(key, state);
    else pendingRef.current.delete(key);
    if (alive.v) setPending(Object.fromEntries(pendingRef.current));
  };

  const categoryOfRow = (r: SourceResult) => {
    const v = rowCat[resultKey(r)];
    return v !== undefined ? v : 'audiobook';
  };

  const addResult = async (r: SourceResult, watch: false | 'tv' | 'phone') => {
    const key = resultKey(r);
    if (pendingRef.current.has(key)) return;
    if (watch === 'tv' && !tv) {
      navigate({ name: 'tv' });
      return;
    }
    const c = client.value;
    if (!c) {
      setError(t('errors.noServerSelected'));
      return;
    }
    setError('');
    try {
      const hash = await addSearchResult(r, categoryOfRow(r), {
        onStep: (s) => markRow(key, s),
        alive: () => alive.v,
        picked: rowCat[key] !== undefined,
      });
      if (!hash || !alive.v) return;
      if (watch === 'tv') {
        await launch.start({
          hash,
          label: r.Title,
          onError: setError,
          onLaunched: (name) => showToast(t('add.launchedOn', { name })),
        });
        return;
      }
      if (!watch) showToast(t('notify.added'));
      if (watch === 'phone') navigate({ name: 'audiobook', hash });
    } catch (err) {
      if (alive.v) setError(errorMessage(err));
    } finally {
      markRow(key, null);
    }
  };

  const matching = rows ? filterByKind(rows, 'audiobook') : [];
  const visible = searching ? stableOrder(orderRef.current, matching, 'seeds') : sortResults(matching, 'seeds');
  orderRef.current = visible.map(resultKey);

  return (
    <div class="m-screen" data-route="audiobook-search">
      <AudiobookBar title={t('audiobooks.searchTitle')} />
      <form class="m-add-row" onSubmit={onSearch}>
        <input
          class="m-input m-lib-search"
          type="search"
          aria-label={t('audiobooks.searchLabel')}
          placeholder={t('audiobooks.searchLabel')}
          enterkeyhint="search"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="m-btn m-btn-secondary m-btn-sm" aria-label={t('add.go')}>
          <Icon d={SEARCH} size={18} />
        </button>
      </form>
      {prog && prog.total > 0 && (
        <div class="m-muted m-small" role="status" data-search-progress>
          {progressText({
            found: visible.length,
            answered: prog.answered,
            total: prog.total,
            pending: prog.pending.map(sourceName),
            failed: prog.failed.map(sourceName),
          })}
        </div>
      )}
      {prog && prog.total === 0 && <div class="m-muted">{t('add.noneSelected')}</div>}
      {error && <LaunchError message={error} />}
      {!searching && prog && prog.total > 0 && visible.length === 0 && (
        <p class="m-muted m-note" data-empty="search">
          {t('audiobooks.emptySearch')}
        </p>
      )}
      <div class="m-results">
        {visible.map((r) => {
          const k = resultKey(r);
          return (
            <ResultCard
              key={k}
              r={r}
              category={categoryOfRow(r)}
              busy={pending[k]}
              onCategory={(id) => setRowCat({ ...rowCat, [k]: id })}
              onAdd={() => void addResult(r, false)}
              onWatch={() => void addResult(r, 'tv')}
              onPhone={() => void addResult(r, 'phone')}
            />
          );
        })}
      </div>
      {launch.sheet}
    </div>
  );
}
