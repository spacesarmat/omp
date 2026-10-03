import { useEffect, useRef, useState } from 'preact/hooks';
import { client } from '../store/servers';
import type { SearchSource } from '../api/torrserver';
import type { SearchResult } from '../api/types';
import { errorMessage } from '../api/http';
import { mapSearchCategory } from '../lib/category';
import { replaceRoute } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, ChoiceRow, Spinner } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { toast } from '../ui/toast';
import { platformKind } from '../platform/env';
import { tvSourceContext } from '../sources/tvContext';
import { searchAll } from '../sources/search';
import type { SearchHandle } from '../sources/search';
import { getHealth } from '../sources/store';
import { isCloudflare, JACKETT_HINT, progressText, resolveLink, resultDate, resultKey, sortResults, sourceBadge, sourceName, stableOrder } from '../sources/view';
import type { SourceResult } from '../sources/types';

const SOURCES: { value: SearchSource; label: string }[] = [
  { value: 'rutor', label: 'Rutor' },
  { value: 'torznab', label: 'Torznab (Jackett)' },
];


interface Prog {
  answered: number;
  total: number;
  pending: string[];
  failed: string[];
}

function unifiedMeta(r: SourceResult): string {
  const parts = [r.Size, 'сиды ' + r.Seed, 'пиры ' + r.Peer];
  const d = resultDate(r);
  if (d) parts.push(d);
  if (r.sources && r.sources.length) parts.push('ещё в ' + r.sources.map(sourceName).join(', '));
  return parts.filter(Boolean).join(' · ');
}

export function AddScreen() {
  const c = client.value!;
  // Android TV searches every source at once (spec «Общий поиск»); LG keeps the TorrServer search
  const unified = platformKind() === 'androidtv';
  const alive = useRef(true);
  const handle = useRef<SearchHandle | null>(null);
  // row order on screen while results stream in: shown rows keep their places under the cursor
  const order = useRef<string[]>([]);
  const [link, setLink] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SearchSource>('rutor');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [rows, setRows] = useState<SourceResult[] | null>(null);
  const [prog, setProg] = useState<Prog | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('Подождите…');

  useEffect(() => {
    restoreFocus('ADD');
    return () => {
      alive.current = false;
      if (handle.current) handle.current.cancel();
      handle.current = null;
    };
  }, []);

  const doAdd = (p: { link: string; title?: string; category?: string }) => {
    setBusyText('Подождите…');
    c.add({ link: p.link, title: p.title, category: p.category }).then(
      (t) => {
        if (!alive.current) return;
        toast('Добавлено: ' + (t.title || p.title || t.hash));
        replaceRoute({ name: 'torrent', hash: t.hash });
      },
      (e) => {
        if (!alive.current) return;
        setBusy(false);
        toast(errorMessage(e), 'error');
      },
    );
  };

  const add = (p: { link: string; title?: string; category?: string }) => {
    if (busy) return;
    const l = p.link.trim();
    if (!l) {
      toast('Введите magnet-ссылку, хеш или URL .torrent', 'error');
      return;
    }
    setBusy(true);
    doAdd({ link: l, title: p.title, category: p.category });
  };

  // nnmclub, rutracker: the magnet is on the release page; Anidub, BigFANGroup: an http(s) .torrent link
  const addResult = (r: SourceResult) => {
    if (busy) return;
    setBusy(true);
    setBusyText('Получаю ссылку…');
    resolveLink(r, tvSourceContext()).then(
      (l) => {
        if (!alive.current) return;
        doAdd({ link: l, title: r.Title, category: mapSearchCategory(r.Categories) });
      },
      (e) => {
        if (!alive.current) return;
        setBusy(false);
        toast(errorMessage(e), 'error');
      },
    );
  };

  const sync = (h: SearchHandle) => {
    if (!alive.current || handle.current !== h) return;
    setRows(h.results());
    setProg({ answered: h.answered().length, total: h.sourceIds.length, pending: h.pending(), failed: h.failed() });
  };

  const searchUnified = (q: string) => {
    if (handle.current) handle.current.cancel();
    const h: SearchHandle = searchAll(q, {
      ctx: tvSourceContext(),
      onResult: () => sync(h),
      onDone: () => sync(h),
    });
    handle.current = h;
    order.current = [];
    sync(h);
    h.done.then(() => {
      if (!alive.current || handle.current !== h) return;
      sync(h);
      if (!h.results().length) toast('Ничего не найдено');
    });
  };

  const search = () => {
    if (busy) return;
    const q = query.trim();
    if (!q) return;
    if (unified) {
      searchUnified(q);
      return;
    }
    setBusy(true);
    setResults(null);
    c.search(q, source).then(
      (r) => {
        if (!alive.current) return;
        setBusy(false);
        setResults(r);
        if (!r.length) toast('Ничего не найдено');
      },
      (e) => {
        if (!alive.current) return;
        setBusy(false);
        toast(errorMessage(e), 'error');
      },
    );
  };

  const streaming = !!prog && prog.pending.length > 0;
  const sorted = rows ? (streaming ? stableOrder(order.current, rows, 'seeds') : sortResults(rows, 'seeds')) : [];
  order.current = sorted.map(resultKey);
  const blocked = prog ? prog.failed.filter((id) => isCloudflare((getHealth(id) || { message: '' }).message)) : [];

  return (
    <FocusGroup focusKey="ADD" className="screen add">
      <h1>Добавить торрент</h1>
      <h2>Magnet-ссылка, хеш или URL .torrent</h2>
      <div class="row">
        <TextInput focusKey="add-link" value={link} onChange={setLink} placeholder="magnet:?xt=urn:btih:…" onSubmit={() => add({ link })} />
        <Button label="Добавить" onPress={() => add({ link })} disabled={busy} />
      </div>
      <h2>{unified ? 'Поиск по источникам' : 'Поиск'}</h2>
      <div class="row">
        <TextInput value={query} onChange={setQuery} placeholder="Название фильма или сериала" onSubmit={search} />
        {!unified && <ChoiceRow label="Источник" value={source} options={SOURCES} onChange={setSource} />}
        <Button label="Искать" onPress={search} disabled={busy} />
      </div>
      {busy && <Spinner text={busyText} />}
      {unified && prog && (
        <div class="search-progress">
          {prog.total
            ? progressText({
                found: sorted.length,
                answered: prog.answered,
                total: prog.total,
                pending: prog.pending.map(sourceName),
                failed: prog.failed.map(sourceName),
              })
            : 'Нет включённых источников'}
        </div>
      )}
      {unified && blocked.length > 0 && (
        <div class="search-progress search-hint">
          {blocked.map((id) => sourceName(id) + ': ' + (getHealth(id) || { message: '' }).message).join('; ') + '. ' + JACKETT_HINT}
        </div>
      )}
      {unified && rows && (
        <FocusGroup focusKey="ADD-RESULTS">
          {sorted.map((r) => (
            // focus key from the row identity, not its place: rows stream in and the cursor must stay on its row
            <Focusable key={resultKey(r)} focusKey={'res-' + resultKey(r)} className="list-item" onPress={() => addResult(r)}>
              <div class="title">{r.Title}</div>
              <div class="meta">
                <span class="src-badge">{sourceBadge(r)}</span>
                {unifiedMeta(r)}
              </div>
            </Focusable>
          ))}
        </FocusGroup>
      )}
      {!unified && results && (
        <FocusGroup focusKey="ADD-RESULTS">
          {results.map((r, i) => (
            <Focusable
              key={i}
              focusKey={'res-' + i}
              className="list-item"
              onPress={() => add({ link: r.Magnet || r.Link, title: r.Title, category: mapSearchCategory(r.Categories) })}
            >
              <div class="title">{r.Title}</div>
              <div class="meta">
                {r.Size} · сиды {r.Seed} · пиры {r.Peer} · {r.Tracker}{r.CreateDate ? ' · ' + r.CreateDate.slice(0, 10) : ''}
              </div>
            </Focusable>
          ))}
        </FocusGroup>
      )}
      {!unified && <div class="hints">Текст удобно вводить с клавиатуры телефона в приложении LG ThinQ</div>}
    </FocusGroup>
  );
}
