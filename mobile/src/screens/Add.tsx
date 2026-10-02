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
import { errorMessage } from '../../../src/api/http';
import type { SearchResult } from '../../../src/api/types';
import type { SearchSource } from '../../../src/api/torrserver';

const PLUS = 'M12 5v14M5 12h14';
const TV_PLAY = 'M3 5h18v11H3zM8 20h8M10 8.5l4 2.5-4 2.5z';
const SEARCH = 'M5 11a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M20 20l-4.5-4.5';

const HASH = /^[0-9a-fA-F]{40}$/;

/** Accepts a magnet link or a bare 40-char info hash; returns a magnet link or null. */
export function normalizeLink(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (HASH.test(s)) return 'magnet:?xt=urn:btih:' + s;
  if (/^magnet:\?/i.test(s)) return s;
  return null;
}

function linkOf(r: SearchResult): string {
  return r.Magnet || r.Link || (r.Hash ? 'magnet:?xt=urn:btih:' + r.Hash : '');
}

function meta(r: SearchResult): string {
  return [r.Size, r.Seed + ' сид.', r.Tracker].filter(Boolean).join(' · ');
}

export function Add({ link }: { link?: string }) {
  const [value, setValue] = useState(link || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SearchSource>('rutor');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [rowCat, setRowCat] = useState<Record<string, string>>({});
  const [catSheet, setCatSheet] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [alive] = useState({ v: true });
  const pendingRef = useRef<Set<string>>(new Set());
  const searchToken = useRef(0);
  const launch = useTvLaunch();
  const tv = activeTv.value;

  useEffect(
    () => () => {
      alive.v = false;
      searchToken.current++;
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
  const rowKey = (r: SearchResult) => r.Hash || r.Title;
  const categoryOfRow = (r: SearchResult) => {
    const v = rowCat[rowKey(r)];
    return v !== undefined ? v : guessCategory(r.Title);
  };

  const addLink = async (l: string): Promise<string | null> => {
    const c = client.value;
    if (!c) {
      setError('Сервер не выбран');
      return null;
    }
    const t = await c.add({ link: l, category: magnetCategory });
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

  const onSearch = async (e?: Event) => {
    e?.preventDefault();
    const q = query.trim();
    const c = client.value;
    if (!q || !c) return;
    const token = ++searchToken.current;
    setSearching(true);
    setSearchError('');
    try {
      const r = await c.search(q, source);
      if (alive.v && token === searchToken.current) setResults(r);
    } catch (err) {
      if (alive.v && token === searchToken.current) {
        setResults(null);
        setSearchError(errorMessage(err));
      }
    } finally {
      if (alive.v && token === searchToken.current) setSearching(false);
    }
  };

  const pickSource = (s: SearchSource) => {
    if (s === source) return;
    searchToken.current++;
    setSource(s);
    setResults(null);
    setSearching(false);
    setSearchError('');
  };

  const addResult = async (r: SearchResult, watch: boolean) => {
    const key = r.Hash || r.Title;
    if (pendingRef.current.has(key)) return;
    const l = linkOf(r);
    if (!l) {
      showToast('У результата нет ссылки');
      return;
    }
    if (watch && !tv) {
      navigate({ name: 'tv' });
      return;
    }
    pendingRef.current.add(key);
    setPending({ ...Object.fromEntries([...pendingRef.current].map((k) => [k, true])) });
    setSearchError('');
    try {
      const c = client.value;
      if (!c) throw new Error('Сервер не выбран');
      const hash = (await c.add({ link: l, category: categoryOfRow(r) })).hash;
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
      pendingRef.current.delete(key);
      if (alive.v) setPending(Object.fromEntries([...pendingRef.current].map((k) => [k, true])));
    }
  };

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
      <h2 class="m-add-title">Поиск на сервере</h2>
      <form class="m-add-row" onSubmit={onSearch}>
        <input
          class="m-input m-lib-search"
          aria-label="Поиск на сервере"
          placeholder="Название"
          enterkeyhint="search"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="m-btn m-btn-secondary m-btn-sm" aria-label="Искать" disabled={searching}>
          <Icon d={SEARCH} size={18} />
        </button>
      </form>
      <div class="m-chips">
        {(['rutor', 'torznab'] as SearchSource[]).map((s) => (
          <button
            type="button"
            class={'m-chip' + (source === s ? ' on' : '')}
            aria-pressed={source === s}
            onClick={() => pickSource(s)}
          >
            {s === 'rutor' ? 'Встроенный' : 'Torznab'}
          </button>
        ))}
      </div>
      {searching && <div class="m-muted">Ищу…</div>}
      {searchError && <LaunchError message={searchError} />}
      {results && !searching && results.length === 0 && <div class="m-muted">Ничего не найдено</div>}
      <div class="m-results">
        {(results || []).map((r) => (
          <div class="m-result">
            <div class="m-result-text">
              <div class="m-result-title">{r.Title}</div>
              <div class="m-muted m-small">{meta(r)}</div>
            </div>
            <button
              type="button"
              class="m-chip"
              aria-label={'Категория: ' + addCategoryLabel(categoryOfRow(r))}
              onClick={() => setCatSheet(rowKey(r))}
            >
              {addCategoryLabel(categoryOfRow(r)) + ' ▾'}
            </button>
            <button
              type="button"
              class="m-iconbtn"
              aria-label="Добавить на сервер"
              disabled={!!pending[r.Hash || r.Title]}
              onClick={() => void addResult(r, false)}
            >
              <Icon d={PLUS} size={20} />
            </button>
            <button
              type="button"
              class="m-iconbtn primary"
              aria-label="Добавить и смотреть на ТВ"
              disabled={!!pending[r.Hash || r.Title]}
              onClick={() => void addResult(r, true)}
            >
              <Icon d={TV_PLAY} size={20} />
            </button>
          </div>
        ))}
      </div>
      {catSheet !== null && (
        <Sheet label="Категория" onClose={() => setCatSheet(null)}>
          <div class="m-sheet-title">Категория</div>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            {ADD_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                class={'m-chip' + ((rowCat[catSheet] !== undefined ? rowCat[catSheet] : guessCategory((results || []).filter((x) => rowKey(x) === catSheet)[0]?.Title || '')) === c.id ? ' on' : '')}
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
