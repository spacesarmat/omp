import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { ADD_CATEGORIES, addCategoryLabel, guessCategory, magnetName } from '../../../src/lib/categoryGuess';
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
import {
  filterQuality,
  progressText,
  resolveLink,
  resultDate,
  resultKey,
  sortResults,
  sourceName,
  SORT_LABELS,
  type QualityFilter,
  type SortKey,
} from '../../../src/sources/view';
import type { SourceResult } from '../../../src/sources/types';
import { phoneSourceContext } from '../searchContext';

const SEARCH = 'M5 11a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M20 20l-4.5-4.5';
const CHECK = 'M5 12l5 5l9-10';

const HASH = /^[0-9a-fA-F]{40}$/;

/** Accepts a magnet link or a bare 40-char info hash; returns a magnet link or null. */
export function normalizeLink(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (HASH.test(s)) return 'magnet:?xt=urn:btih:' + s;
  if (/^magnet:\?/i.test(s)) return s;
  return null;
}

function meta(r: SourceResult): string {
  const more = r.sources && r.sources.length ? 'ещё в ' + r.sources.map(sourceName).join(', ') : '';
  return [r.Size, r.Seed + ' сид.', resultDate(r), more].filter(Boolean).join(' · ');
}

interface Prog {
  answered: number;
  total: number;
  pending: string[];
  failed: string[];
}

/** Row state while adding: taking the link from the release page, then adding. */
type RowBusy = 'link' | 'add';

export function Add({ link }: { link?: string }) {
  const [value, setValue] = useState(link || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [quality, setQuality] = useState<QualityFilter>('');
  const [sort, setSort] = useState<SortKey>('seeds');
  const [rows, setRows] = useState<SourceResult[] | null>(null);
  const [prog, setProg] = useState<Prog | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [sheet, setSheet] = useState<'sources' | 'sort' | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [rowCat, setRowCat] = useState<Record<string, string>>({});
  const [catSheet, setCatSheet] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, RowBusy>>({});
  const [alive] = useState({ v: true });
  const pendingRef = useRef<Map<string, RowBusy>>(new Map());
  const handle = useRef<SearchHandle | null>(null);
  const launch = useTvLaunch();
  const tv = activeTv.value;

  useEffect(
    () => () => {
      alive.v = false;
      if (handle.current) handle.current.cancel();
      handle.current = null;
    },
    [],
  );
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

  const sync = (h: SearchHandle) => {
    if (!alive.v || handle.current !== h) return;
    setRows(h.results());
    setProg({ answered: h.answered().length, total: h.sourceIds.length, pending: h.pending(), failed: h.failed() });
  };

  const onSearch = (e?: Event) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (handle.current) handle.current.cancel();
    setSearchError('');
    // callbacks come asynchronously, after `h` is assigned
    const h: SearchHandle = searchAll(q, {
      ctx: phoneSourceContext(),
      sources: selected,
      onResult: () => sync(h),
      onDone: () => sync(h),
    });
    handle.current = h;
    setSearching(true);
    sync(h);
    void h.done.then(() => {
      if (!alive.v || handle.current !== h) return;
      sync(h);
      setSearching(false);
    });
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
    markRow(key, 'link');
    setSearchError('');
    try {
      // nnmclub, rutracker: the magnet is on the release page; Anidub, BigFANGroup: an http(s) .torrent link
      const l = await resolveLink(r, phoneSourceContext());
      if (!alive.v) return;
      markRow(key, 'add');
      const added = await c.add({ link: l, category: categoryOfRow(r) });
      void rememberAdded(c, added, r.Title);
      const hash = added.hash;
      if (!alive.v) return;
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

  const visible = rows ? sortResults(filterQuality(rows, quality), sort) : [];
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
        <button type="button" class={'m-chip' + (allChosen ? ' on' : '')} onClick={() => setSheet('sources')}>
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
        <button type="button" class="m-chip" onClick={() => setSheet('sort')}>
          {sortLabel + ' ▾'}
        </button>
      </div>
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
      {searchError && <LaunchError message={searchError} />}
      {!searching && prog && prog.total > 0 && visible.length === 0 && <div class="m-muted">Ничего не найдено</div>}
      <div class="m-results">
        {visible.map((r) => {
          const k = resultKey(r);
          return (
            <div class="m-result m-result-card" key={k}>
              <div class="m-result-title">{r.Title}</div>
              <div class="m-result-meta m-small">
                <span class="m-src-badge">{sourceName(r.source)}</span>
                <span class="m-muted">{meta(r)}</span>
              </div>
              {pending[k] === 'link' && (
                <div class="m-muted m-small" role="status">
                  Получаю ссылку…
                </div>
              )}
              <div class="m-result-actions">
                <button
                  type="button"
                  class="m-chip"
                  aria-label={'Категория: ' + addCategoryLabel(categoryOfRow(r))}
                  onClick={() => setCatSheet(k)}
                >
                  {addCategoryLabel(categoryOfRow(r)) + ' ▾'}
                </button>
                <span class="m-grow" />
                <button
                  type="button"
                  class="m-btn m-btn-secondary m-btn-sm"
                  aria-label="Добавить на сервер"
                  disabled={!!pending[k]}
                  onClick={() => void addResult(r, false)}
                >
                  Добавить
                </button>
                <button
                  type="button"
                  class="m-btn m-btn-primary m-btn-sm"
                  aria-label="Добавить и смотреть на ТВ"
                  disabled={!!pending[k]}
                  onClick={() => void addResult(r, true)}
                >
                  На ТВ
                </button>
              </div>
            </div>
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
      {launch.sheet}
    </div>
  );
}
