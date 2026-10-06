import { useEffect, useRef, useState } from 'preact/hooks';
import { client } from '../store/servers';
import type { SearchSource } from '../api/torrserver';
import type { SearchResult } from '../api/types';
import { errorMessage } from '../api/http';
import { mapSearchCategory } from '../lib/category';
import { currentRoute, replaceRoute } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, ChoiceRow, Spinner } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { toast } from '../ui/toast';
import { t } from '../i18n';
import { platformKind } from '../platform/env';
import { tvSourceContext } from '../sources/tvContext';
import { searchAll } from '../sources/search';
import { onSearchFailure, type CheckedHosts } from '../sources/cloudflareCheck';
import type { SearchHandle } from '../sources/search';
import { getHealth } from '../sources/store';
import { ipBanTvHint } from '../sources/ipBan';
import { ipBanNote, isCloudflare, jackettHint, progressText, resolveLink, resultDate, resultKey, sortResults, sourceBadge, sourceName, stableOrder } from '../sources/view';
import type { SourceResult } from '../sources/types';
import { tvGlyphs } from '../ui/tvText';

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
  const parts = [r.Size, t('add.seeds', { n: r.Seed }), t('add.peers', { n: r.Peer })];
  const d = resultDate(r);
  if (d) parts.push(d);
  if (r.sources && r.sources.length) parts.push(t('add.alsoIn', { names: r.sources.map(sourceName).join(', ') }));
  return parts.filter(Boolean).join(' · ');
}

export function AddScreen() {
  // the route's `query` prefills the search; with `run` the search starts at once (a missing season of a series)
  const route = currentRoute.peek();
  const p = route.name === 'add' ? route : { query: undefined, run: undefined };
  const c = client.value!;
  // Android TV searches every source at once (spec «Общий поиск»); LG keeps the TorrServer search
  const unified = platformKind() === 'androidtv';
  const alive = useRef(true);
  const handle = useRef<SearchHandle | null>(null);
  // row order on screen while results stream in: shown rows keep their places under the cursor
  const order = useRef<string[]>([]);
  const [link, setLink] = useState('');
  const [query, setQuery] = useState(p.query || '');
  const [source, setSource] = useState<SearchSource>('rutor');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [rows, setRows] = useState<SourceResult[] | null>(null);
  const [prog, setProg] = useState<Prog | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState(t('add.wait'));

  useEffect(() => {
    restoreFocus('ADD');
    if (p.run && p.query && p.query.trim()) search(p.query);
    return () => {
      alive.current = false;
      if (handle.current) handle.current.cancel();
      handle.current = null;
    };
  }, []);

  const doAdd = (p: { link: string; title?: string; category?: string }) => {
    setBusyText(t('add.wait'));
    c.add({ link: p.link, title: p.title, category: p.category }).then(
      (tt) => {
        if (!alive.current) return;
        toast(t('add.added', { title: tt.title || p.title || tt.hash }));
        replaceRoute({ name: 'torrent', hash: tt.hash });
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
      toast(t('add.enterLink'), 'error');
      return;
    }
    setBusy(true);
    doAdd({ link: l, title: p.title, category: p.category });
  };

  // nnmclub, rutracker: the magnet is on the release page; Anidub, BigFANGroup: an http(s) .torrent link
  const addResult = (r: SourceResult) => {
    if (busy) return;
    setBusy(true);
    setBusyText(t('add.gettingLink'));
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

  // asked: the sites whose visible Cloudflare check this search (and its retries) has already opened
  const searchUnified = (q: string, asked: CheckedHosts = {}) => {
    if (handle.current) handle.current.cancel();
    const h: SearchHandle = searchAll(q, {
      ctx: tvSourceContext(),
      onResult: () => sync(h),
      onDone: (id, err) => {
        sync(h);
        // a site behind Cloudflare wants a person: the dialog opens, the search runs again once it is passed
        if (err) onSearchFailure(id, err, asked, () => {
          if (alive.current && handle.current === h) searchUnified(q, asked);
        });
      },
    });
    handle.current = h;
    order.current = [];
    sync(h);
    h.done.then(() => {
      if (!alive.current || handle.current !== h) return;
      sync(h);
      if (!h.results().length) toast(t('catalog.nothingFound'));
    });
  };

  const search = (text?: string) => {
    if (busy) return;
    const q = (typeof text === 'string' ? text : query).trim();
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
        if (!r.length) toast(t('catalog.nothingFound'));
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
  // a site that showed its code page: its message, and where to enter the code (no browser on the TV)
  const banned = prog ? prog.failed.map(ipBanNote).filter((x) => !!x) : [];

  return (
    <FocusGroup focusKey="ADD" className="screen add">
      <h1>{t('add.title')}</h1>
      <h2>{t('add.linkHeading')}</h2>
      <div class="row">
        <TextInput focusKey="add-link" value={link} onChange={setLink} placeholder="magnet:?xt=urn:btih:…" onSubmit={() => add({ link })} />
        <Button label={t('common.add')} onPress={() => add({ link })} disabled={busy} />
      </div>
      <h2>{unified ? t('add.searchBySources') : t('add.search')}</h2>
      <div class="row">
        <TextInput value={query} onChange={setQuery} placeholder={t('add.queryPlaceholder')} onSubmit={() => search()} />
        {!unified && <ChoiceRow label={t('add.source')} value={source} options={SOURCES} onChange={setSource} />}
        <Button label={t('add.go')} onPress={() => search()} disabled={busy} />
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
            : t('add.noSources')}
        </div>
      )}
      {unified && blocked.length > 0 && (
        <div class="search-progress search-hint">
          {blocked.map((id) => sourceName(id) + ': ' + (getHealth(id) || { message: '' }).message).join('; ') + '. ' + jackettHint()}
        </div>
      )}
      {unified && banned.length > 0 && (
        <div class="search-progress search-hint" data-hint="ipban">
          {banned.join('; ') + '. ' + ipBanTvHint()}
        </div>
      )}
      {unified && rows && (
        <FocusGroup focusKey="ADD-RESULTS">
          {sorted.map((r) => (
            // focus key from the row identity, not its place: rows stream in and the cursor must stay on its row
            <Focusable key={resultKey(r)} focusKey={'res-' + resultKey(r)} className="list-item" onPress={() => addResult(r)}>
              <div class="title">{tvGlyphs(r.Title)}</div>
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
              <div class="title">{tvGlyphs(r.Title)}</div>
              <div class="meta">
                {r.Size} · {t('add.seeds', { n: r.Seed })} · {t('add.peers', { n: r.Peer })} · {r.Tracker}{r.CreateDate ? ' · ' + r.CreateDate.slice(0, 10) : ''}
              </div>
            </Focusable>
          ))}
        </FocusGroup>
      )}
      {!unified && <div class="hints">{t('add.typeHint')}</div>}
    </FocusGroup>
  );
}
