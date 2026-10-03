import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { ADD_CATEGORIES, guessCategory, magnetName } from '../../../src/lib/categoryGuess';
import { TvChip } from '../ui/TvChip';
import { showToast } from '../ui/toast';
import { LaunchError } from '../ui/LaunchError';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { useTvLaunch } from '../watch';
import { client } from '../../../src/store/servers';
import { rememberAdded } from '../../../src/store/library';
import { errorMessage } from '../../../src/api/http';
import { searchAll, type SearchHandle } from '../../../src/sources/search';
import { allSources } from '../../../src/sources/registry';
import { enabledSources } from '../../../src/sources/store';
import { getHealth } from '../../../src/sources/store';
import {
  filterQuality,
  isCloudflare,
  JACKETT_HINT,
  progressText,
  resultKey,
  sortResults,
  sourceName,
  stableOrder,
  SORT_LABELS,
  type QualityFilter,
  type SortKey,
} from '../../../src/sources/view';
import type { SourceResult } from '../../../src/sources/types';
import { loadSubs } from '../../../src/monitor/subs';
import { ResultCard } from '../ui/ResultCard';
import { SubSheet } from '../ui/SubSheet';
import { addSearchResult, type RowBusy } from '../addResult';
import { monitorVersion } from '../monitor/ui';
import { phoneSourceContext } from '../searchContext';

const SEARCH = 'M5 11a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M20 20l-4.5-4.5';
const CHECK = 'M5 12l5 5l9-10';
const BELL = 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0';

function sameQuery(a: string, b: string): boolean {
  const n = (q: string) => q.replace(/\s+/g, ' ').trim().toLowerCase();
  return n(a) === n(b);
}

/** Above the results of a search: «Подписаться» (with the search's filters), or «Открыть» when already subscribed. */
function SubscribePlate({ query, onSubscribe }: { query: string; onSubscribe: () => void }) {
  const existing = loadSubs().filter((s) => sameQuery(s.query, query))[0];
  return (
    <div class="m-sub-plate" data-plate="subscribe">
      <Icon d={BELL} size={22} />
      <span class="m-grow">{existing ? 'Вы подписаны на этот запрос' : 'Сообщить, когда появятся новые раздачи по этому запросу'}</span>
      {existing ? (
        <button type="button" class="m-btn m-btn-primary m-btn-sm" onClick={() => navigate({ name: 'subFindings', id: existing.id })}>
          Открыть
        </button>
      ) : (
        <button type="button" class="m-btn m-btn-primary m-btn-sm" onClick={onSubscribe}>
          Подписаться
        </button>
      )}
    </div>
  );
}

const HASH = /^[0-9a-fA-F]{40}$/;

/** Accepts a magnet link or a bare 40-char info hash; returns a magnet link or null. */
export function normalizeLink(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (HASH.test(s)) return 'magnet:?xt=urn:btih:' + s;
  if (/^magnet:\?/i.test(s)) return s;
  return null;
}

interface Prog {
  answered: number;
  total: number;
  pending: string[];
  failed: string[];
}

/**
 * The last search outlives the screen: going to «Источники поиска» (or another tab) and back shows the same
 * results, and a search still running keeps streaming into them.
 */
interface SearchMemo {
  query: string;
  /** The query of the search on screen and the filters it ran with (the «Подписаться» plate). */
  searched: string;
  searchedQuality: QualityFilter;
  searchedSources: string[] | null;
  chosen: string[] | null;
  quality: QualityFilter;
  sort: SortKey;
  handle: SearchHandle | null;
  /** Row order on screen while results stream in. */
  order: string[];
  rowCat: Record<string, string>;
  /** Server the search ran on: another active server starts from scratch. */
  server: string | null;
  /** Rows being added: a request still running when the screen is left keeps its row busy on return. */
  busy: Map<string, RowBusy>;
}

function freshMemo(): SearchMemo {
  return { query: '', searched: '', searchedQuality: '', searchedSources: null, chosen: null, quality: '', sort: 'seeds', handle: null, order: [], rowCat: {}, server: null, busy: new Map() };
}

let memo: SearchMemo = freshMemo();
let listener: ((h: SearchHandle) => void) | null = null;

/** Forgets the last search (tests, server change). */
export function resetAddSearch(): void {
  if (memo.handle) memo.handle.cancel();
  memo = freshMemo();
}

function progOf(h: SearchHandle): Prog {
  return { answered: h.answered().length, total: h.sourceIds.length, pending: h.pending(), failed: h.failed() };
}

export function Add({ link }: { link?: string }) {
  // results of another server must not be added to this one
  const server = client.value ? client.value.baseUrl : null;
  if (memo.handle && memo.server !== server) resetAddSearch();
  const [value, setValue] = useState(link || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQueryState] = useState(memo.query);
  const [chosen, setChosenState] = useState<string[] | null>(memo.chosen);
  const [quality, setQualityState] = useState<QualityFilter>(memo.quality);
  const [sort, setSortState] = useState<SortKey>(memo.sort);
  const [rows, setRows] = useState<SourceResult[] | null>(memo.handle ? memo.handle.results() : null);
  const [prog, setProg] = useState<Prog | null>(memo.handle ? progOf(memo.handle) : null);
  const [searching, setSearching] = useState(memo.handle ? memo.handle.pending().length > 0 : false);
  const [searchError, setSearchError] = useState('');
  const [sheet, setSheet] = useState<'sources' | 'sort' | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [rowCat, setRowCatState] = useState<Record<string, string>>(memo.rowCat);
  const [catSheet, setCatSheet] = useState<string | null>(null);
  const [subSheet, setSubSheet] = useState(false);
  void monitorVersion.value;
  const [pending, setPending] = useState<Record<string, RowBusy>>(() => Object.fromEntries(memo.busy));
  const [alive] = useState({ v: true });
  const pendingRef = useRef<Map<string, RowBusy>>(memo.busy);
  const launch = useTvLaunch();
  const tv = activeTv.value;

  const setQuery = (v: string) => {
    memo.query = v;
    setQueryState(v);
  };
  const setChosen = (v: string[] | null) => {
    memo.chosen = v;
    setChosenState(v);
  };
  // a new filter or sort re-sorts everything at once
  const setQuality = (v: QualityFilter) => {
    memo.quality = v;
    memo.order = [];
    setQualityState(v);
  };
  const setSort = (v: SortKey) => {
    memo.sort = v;
    memo.order = [];
    setSortState(v);
  };
  const setRowCat = (v: Record<string, string>) => {
    memo.rowCat = v;
    setRowCatState(v);
  };

  const sync = (h: SearchHandle) => {
    if (!alive.v || memo.handle !== h) return;
    setRows(h.results());
    setProg(progOf(h));
    setSearching(h.pending().length > 0);
  };

  useEffect(() => {
    listener = sync;
    if (memo.handle) sync(memo.handle);
    return () => {
      alive.v = false;
      if (listener === sync) listener = null;
    };
  }, []);
  useEffect(() => {
    if (link) changeValue(link);
  }, [link]);

  // replacing a link by a different one forgets the category picked for the previous one
  // (a pick made before any link was typed stays)
  const changeValue = (v: string) => {
    const prev = normalizeLink(value);
    if (prev && normalizeLink(v) !== prev) setPicked(null);
    setValue(v);
  };

  const magnetCategory = picked !== null ? picked : guessCategory(magnetName(value));
  const categoryOfRow = (r: SourceResult) => {
    const v = rowCat[resultKey(r)];
    return v !== undefined ? v : guessCategory(r.Title);
  };

  const addLink = async (l: string): Promise<string | null> => {
    const c = client.value;
    if (!c) {
      setError('Сервер не выбран');
      return null;
    }
    const t = await c.add({ link: l, category: magnetCategory });
    void rememberAdded(c, t, magnetName(l));
    return t.hash;
  };

  const onAdd = async () => {
    const l = normalizeLink(value);
    if (!l) {
      setError('Вставьте magnet-ссылку или хеш из 40 символов');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const hash = await addLink(l);
      if (hash && alive.v) {
        showToast('Добавлено');
        setPicked(null);
        navigate({ name: 'torrent', hash });
      }
    } catch (e) {
      if (alive.v) setError(errorMessage(e));
    } finally {
      if (alive.v) setBusy(false);
    }
  };

  // sources of this search: the ones picked in the sheet, else those switched on in «Источники поиска»
  const all = allSources();
  const enabledIds = enabledSources(all).map((s) => s.id);
  const selected = chosen || enabledIds;
  const allChosen = chosen === null || (chosen.length === enabledIds.length && enabledIds.every((id) => chosen.indexOf(id) >= 0));
  const sourcesLabel = allChosen ? 'Все источники · ' + enabledIds.length : 'Источники · ' + selected.length;

  const onSearch = (e?: Event) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (memo.handle) memo.handle.cancel();
    setSearchError('');
    // callbacks come asynchronously, after `h` is assigned; they reach whichever Add screen is open
    const notify = () => {
      if (listener) listener(h);
    };
    const h: SearchHandle = searchAll(q, {
      ctx: phoneSourceContext(),
      sources: selected,
      onResult: notify,
      onDone: notify,
    });
    memo.handle = h;
    memo.searched = q;
    memo.searchedQuality = quality;
    memo.searchedSources = allChosen ? null : selected;
    memo.server = server;
    memo.order = [];
    sync(h);
  };

  const toggleChosen = (id: string) => {
    const next = selected.indexOf(id) >= 0 ? selected.filter((x) => x !== id) : selected.concat([id]);
    setChosen(all.map((s) => s.id).filter((x) => next.indexOf(x) >= 0));
  };

  const markRow = (key: string, state: RowBusy | null) => {
    if (state) pendingRef.current.set(key, state);
    else pendingRef.current.delete(key);
    if (alive.v) setPending(Object.fromEntries(pendingRef.current));
  };

  const addResult = async (r: SourceResult, watch: boolean) => {
    const key = resultKey(r);
    if (pendingRef.current.has(key)) return;
    if (watch && !tv) {
      navigate({ name: 'tv' });
      return;
    }
    const c = client.value;
    if (!c) {
      setSearchError('Сервер не выбран');
      return;
    }
    setSearchError('');
    try {
      const hash = await addSearchResult(r, categoryOfRow(r), { onStep: (s) => markRow(key, s), alive: () => alive.v });
      if (!hash || !alive.v) return;
      if (!watch) {
        showToast('Добавлено на сервер');
        return;
      }
      await launch.start({
        hash,
        label: r.Title,
        onError: setSearchError,
        onLaunched: (name) => showToast('Запустил на ' + name),
      });
    } catch (err) {
      if (alive.v) setSearchError(errorMessage(err));
    } finally {
      markRow(key, null);
    }
  };

  // while sources still answer, rows on screen keep their places (no row moves under the finger);
  // the full sort comes when the search ends
  const filtered = rows ? filterQuality(rows, quality) : [];
  const visible = searching ? stableOrder(memo.order, filtered, sort) : sortResults(filtered, sort);
  memo.order = visible.map(resultKey);
  const blocked = prog ? prog.failed.filter((id) => isCloudflare((getHealth(id) || { message: '' }).message)) : [];
  const sortLabel = SORT_LABELS.filter((s) => s.key === sort)[0].label;
  const catRow = catSheet !== null ? (rows || []).filter((x) => resultKey(x) === catSheet)[0] : undefined;

  return (
    <div class="m-screen" data-route="add">
      <div class="m-lib-head">
        <h1 class="m-lib-brand">Добавить</h1>
        <TvChip />
      </div>
      <div class="m-add-row">
        <input
          class="m-input m-lib-search"
          aria-label="Magnet-ссылка или хеш"
          placeholder="magnet:?xt=urn:btih:…"
          value={value}
          onInput={(e) => changeValue((e.target as HTMLInputElement).value)}
        />
        <button type="button" class="m-btn m-btn-primary m-btn-sm" disabled={busy} onClick={onAdd}>
          Добавить
        </button>
      </div>
      <div class="m-muted m-small">Категория</div>
      <div class="m-chips" style={{ flexWrap: 'wrap' }}>
        {ADD_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            class={'m-chip' + (magnetCategory === c.id ? ' on' : '')}
            aria-pressed={magnetCategory === c.id}
            onClick={() => setPicked(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {error && <div class="m-error">{error}</div>}
      <div class="m-muted m-small">Ссылки magnet из браузера открываются в OMP сами — через «Поделиться».</div>
      <h2 class="m-add-title">Поиск по источникам</h2>
      <form class="m-add-row" onSubmit={onSearch}>
        <input
          class="m-input m-lib-search"
          type="search"
          aria-label="Поиск по источникам"
          placeholder="Название"
          enterkeyhint="search"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="m-btn m-btn-secondary m-btn-sm" aria-label="Искать">
          <Icon d={SEARCH} size={18} />
        </button>
      </form>
      <div class="m-chips" style={{ flexWrap: 'wrap' }}>
        <button type="button" class={'m-chip' + (allChosen ? ' on' : '')} aria-haspopup="dialog" onClick={() => setSheet('sources')}>
          {sourcesLabel}
        </button>
        {(['1080', '2160'] as QualityFilter[]).map((q) => (
          <button
            key={q}
            type="button"
            class={'m-chip' + (quality === q ? ' on' : '')}
            aria-pressed={quality === q}
            onClick={() => setQuality(quality === q ? '' : q)}
          >
            {q === '1080' ? '1080p+' : '2160p'}
          </button>
        ))}
        <button type="button" class="m-chip" aria-haspopup="dialog" onClick={() => setSheet('sort')}>
          {sortLabel + ' ▾'}
        </button>
      </div>
      {memo.handle && memo.searched && (
        <SubscribePlate query={memo.searched} onSubscribe={() => setSubSheet(true)} />
      )}
      {prog && prog.total === 0 && <div class="m-muted">Не выбрано ни одного источника — включите их в настройках, «Источники поиска»</div>}
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
      {blocked.length > 0 && (
        <div class="m-hint-warn" data-hint="jackett">
          {blocked.map((id) => sourceName(id) + ': ' + (getHealth(id) || { message: '' }).message).join('; ')}
          <div>{JACKETT_HINT}</div>
        </div>
      )}
      {searchError && <LaunchError message={searchError} />}
      {!searching && prog && prog.total > 0 && visible.length === 0 && <div class="m-muted">Ничего не найдено</div>}
      <div class="m-results">
        {visible.map((r) => {
          const k = resultKey(r);
          return (
            <ResultCard
              key={k}
              r={r}
              category={categoryOfRow(r)}
              busy={pending[k]}
              onCategory={() => setCatSheet(k)}
              onAdd={() => void addResult(r, false)}
              onWatch={() => void addResult(r, true)}
            />
          );
        })}
      </div>
      {sheet === 'sources' && (
        <Sheet label="Источники для поиска" onClose={() => setSheet(null)}>
          <div class="m-sheet-title">Источники для поиска</div>
          {all.map((s) => {
            const on = selected.indexOf(s.id) >= 0;
            return (
              <button key={s.id} type="button" role="checkbox" aria-checked={on} class="m-opt" onClick={() => toggleChosen(s.id)}>
                <span class="m-opt-name m-grow">{s.name}</span>
                {on && <Icon d={CHECK} size={20} />}
              </button>
            );
          })}
          <button
            type="button"
            class="m-link"
            onClick={() => {
              setSheet(null);
              navigate({ name: 'sources' });
            }}
          >
            Источники поиска
          </button>
        </Sheet>
      )}
      {sheet === 'sort' && (
        <Sheet label="Сортировка" onClose={() => setSheet(null)}>
          <div class="m-sheet-title">Сортировка</div>
          {SORT_LABELS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={sort === s.key}
              class="m-opt"
              onClick={() => {
                setSort(s.key);
                setSheet(null);
              }}
            >
              <span class="m-opt-name m-grow">{s.label}</span>
              {sort === s.key && <Icon d={CHECK} size={20} />}
            </button>
          ))}
        </Sheet>
      )}
      {catSheet !== null && (
        <Sheet label="Категория" onClose={() => setCatSheet(null)}>
          <div class="m-sheet-title">Категория</div>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            {ADD_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                class={'m-chip' + ((rowCat[catSheet] !== undefined ? rowCat[catSheet] : guessCategory(catRow ? catRow.Title : '')) === c.id ? ' on' : '')}
                onClick={() => {
                  setRowCat({ ...rowCat, [catSheet]: c.id });
                  setCatSheet(null);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {subSheet && (
        <SubSheet
          initial={{ query: memo.searched, quality: memo.searchedQuality, sources: memo.searchedSources, notify: true }}
          onClose={() => setSubSheet(false)}
        />
      )}
      {launch.sheet}
    </div>
  );
}
