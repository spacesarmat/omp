// «Найти раздачу» (mockup 6), one screen for LG and Android TV: the search line with «Искать», «Magnet или ссылка»
// and «Источники»; the progress line (who searches: the phone, TorrServer or Android TV's own sources) with the sort
// chip; compact result rows (thumbnail, short title, quality chips, the raw title, size and seeds, the source, «уже в
// медиатеке»). OK on a row resolves its link (through the phone for the phone's rows) and adds it; blue opens the
// release details. Back leaves; the search is cancelled on unmount.
import { useEffect, useRef, useState } from 'preact/hooks';
import { getCurrentFocusKey, setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { client } from '../store/servers';
import { torrents } from '../store/library';
import { errorMessage } from '../api/http';
import { mapSearchCategory } from '../lib/category';
import { recordAutoCategory } from '../lib/categoryCheck';
import { posterColor } from '../lib/libraryView';
import { currentRoute, navigate, replaceRoute } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, Spinner } from '../ui/components';
import { restoreFocus, scrollIntoViewSafe } from '../ui/focus';
import { useKeys } from '../ui/keys';
import { choose } from '../ui/dialog';
import { askText } from '../ui/TextDialog';
import { toast } from '../ui/toast';
import { t } from '../i18n';
import { platformKind } from '../platform/env';
import { tvSourceContext } from '../sources/tvContext';
import { searchAll } from '../sources/search';
import { onSearchFailure, type CheckedHosts } from '../sources/cloudflareCheck';
import { getHealth } from '../sources/store';
import { ipBanTvHint } from '../sources/ipBan';
import { ipBanNote, cloudflareTvNote, isCloudflare, progressText, resultDate, resultKey, sortLabels, sourceBadge, sourceName, type SortKey } from '../sources/view';
import { isHotChip, kindFilterOptions, releaseChips, releaseTitle, resultKindLabel } from '../sources/releaseRow';
import { filterByKind, getKindFilter, setKindFilter, type KindFilter } from '../lib/releaseKind';
import { sortTvResults, stableTvOrder, type TvSortKey } from '../sources/tvSort';
import { posterKey, requestPoster } from '../catalog/resultPosters';
import { phoneLink } from '../phone/phoneStore';
import { PhoneRpcError, phoneRpc } from '../phone/rpc';
import { rememberSourceNames } from '../sources/sourceNames';
import { resultSizeText } from '../sources/resultSize';
import { relevantRows } from '../sources/relevance';
import { resolveTvResult, startTvSearch, type TvResult } from '../phone/phoneSearch';
import type { RpcFailure } from '../phone/rpcTypes';
import { tvGlyphs } from '../ui/tvText';

/** Rows whose posters are asked for at once; the rest only near the cursor. */
const POSTER_FIRST = 12;
const POSTER_NEAR = 4;

interface Prog {
  answered: number;
  total: number;
  pending: string[];
  failed: string[];
  /** Phone sites that failed for a reason the person can fix on the phone (sign-in, code page, Cloudflare). */
  reasons: { id: string; code: ReasonCode }[];
}

type ReasonCode = 'login' | 'ipban' | 'cloudflare';

/** The failures the phone gave a reason for: shown as a per-site note instead of the did-not-answer list. */
export function phoneReasons(list: RpcFailure[]): { id: string; code: ReasonCode }[] {
  const out: { id: string; code: ReasonCode }[] = [];
  list.forEach((f) => {
    // TorrServer's own sources (the fallback) have nothing to fix on the phone
    if (!f || f.id === 'phone' || f.id.indexOf('ts-') === 0) return;
    if (f.code === 'login' || f.code === 'ipban' || f.code === 'cloudflare') out.push({ id: f.id, code: f.code });
  });
  return out;
}

/** The per-site note, e.g. RuTracker needs a sign-in on the phone, torrent.by wants its code entered there. */
export function reasonText(r: { id: string; code: ReasonCode }): string {
  const name = { name: sourceName(r.id) };
  if (r.code === 'login') return t('search.reason.login', name);
  if (r.code === 'ipban') return t('search.reason.ipban', name);
  return t('search.reason.cloudflare', name);
}

/** What the screen reads from a search: the TV's TvSearchHandle, or Android TV's SearchHandle. */
interface Handle {
  sourceIds: string[];
  results(): TvResult[];
  pending(): string[];
  answered(): string[];
  failed(): string[];
  failures?(): RpcFailure[];
  done: Promise<void>;
  cancel(): void;
}

type By = 'phone' | 'torrserver' | 'sources';
type Note = '' | 'phoneDown' | 'noPhone';

/** The message for a row whose link could not be had. */
function resolveError(e: unknown): string {
  if (e instanceof PhoneRpcError) {
    if (e.code === 'timeout' || e.code === 'unreachable') return t('search.phoneSlow');
    if (e.code === 'expired') return t('search.expired');
  }
  return errorMessage(e) || t('sources.cannotGetLink');
}

const cssUrl = (u: string) => u.replace(/["()\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** 72×104 poster: the colour block at once, the poster once `want` is set and the lookup answered. */
function Thumb({ title, want }: { title: string; want: boolean }) {
  const [url, setUrl] = useState('');
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!want || cancel.current) return;
    cancel.current = requestPoster(title, (u) => setUrl(/^https?:\/\//i.test(u) ? u : ''));
  }, [want]);
  useEffect(
    () => () => {
      if (cancel.current) cancel.current();
    },
    [],
  );
  const bg = 'linear-gradient(160deg, ' + posterColor(posterKey(title) || title || '?') + ', #14161C)';
  const style = url ? 'background: url("' + cssUrl(url) + '") center / cover, ' + bg : 'background: ' + bg;
  return <div class="search-thumb" style={style} data-poster-url={url || undefined} />;
}

function DetailsDialog({ r, onAdd, onClose }: { r: TvResult; onAdd: () => void; onClose: () => void }) {
  // above the screen: Back closes, nothing reaches the screen under it
  useKeys((a) => {
    if (a === 'back') {
      onClose();
      return true;
    }
    return 'spatial';
  }, 50);
  useEffect(() => {
    setFocus('search-details-add');
  }, []);
  const names = [r.source].concat(r.sources || []).filter(Boolean).map(sourceName).join(', ');
  const meta = [resultSizeText(r), t('add.seeds', { n: r.Seed || 0 }), t('add.peers', { n: r.Peer || 0 }), resultDate(r), names].filter(Boolean).join(' · ');
  return (
    <div
      class="dialog-backdrop search-details-backdrop"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        onClose();
      }}
    >
      <FocusGroup focusKey="SEARCH-DETAILS" className="dialog search-details" boundary>
        <div class="dialog-title">{t('search.details')}</div>
        <div class="search-details-title">{tvGlyphs(r.Title)}</div>
        <div class="search-details-meta">{tvGlyphs(meta)}</div>
        <div class="search-details-actions">
          <Button focusKey="search-details-add" className="primary" label={t('common.add')} onPress={onAdd} />
        </div>
      </FocusGroup>
    </div>
  );
}

export function AddScreen() {
  // the route's `query` prefills the search; with `run` the search starts at once (a missing season of a series)
  const route = currentRoute.peek();
  const p = route.name === 'add' ? route : { query: undefined, run: undefined };
  const c = client.value!;
  // Android TV searches its own sources; LG searches through the phone, else TorrServer
  const unified = platformKind() === 'androidtv';
  const alive = useRef(true);
  const handle = useRef<Handle | null>(null);
  const unsub = useRef<(() => void) | null>(null);
  // bumped by every search: a phone answer for an older search is dropped
  const seq = useRef(0);
  // row order on screen while results stream in: shown rows keep their places under the cursor
  const order = useRef<string[]>([]);
  // the order the last render showed, and the place of a focused row that this render drops (-1: none)
  const shown = useRef<string[]>([]);
  const refocus = useRef(-1);
  const [query, setQuery] = useState(p.query || '');
  const [rows, setRows] = useState<TvResult[] | null>(null);
  const [prog, setProg] = useState<Prog | null>(null);
  const [by, setBy] = useState<By>(unified ? 'sources' : 'torrserver');
  const [note, setNote] = useState<Note>('');
  const [starting, setStarting] = useState(false);
  const [sortKey, setSortKey] = useState<TvSortKey>('quality');
  // «Все / Фильмы / Сериалы»: kept while the app runs
  const [kindF, setKindF] = useState<KindFilter>(getKindFilter());
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState(t('add.wait'));
  const [rowErr, setRowErr] = useState<{ [key: string]: string }>({});
  const [focusedKey, setFocusedKey] = useState('');
  const [details, setDetails] = useState<TvResult | null>(null);
  // the phone's site names («RuTracker», «NNM-Club»): asked once per screen, a re-render shows them
  const namesAsked = useRef(false);
  const [, setNamesRev] = useState(0);

  const stop = () => {
    seq.current++;
    if (unsub.current) unsub.current();
    unsub.current = null;
    if (handle.current) handle.current.cancel();
    handle.current = null;
  };

  useEffect(() => {
    restoreFocus('add-query');
    if (p.run && p.query && p.query.trim()) search(p.query);
    return () => {
      alive.current = false;
      stop();
    };
  }, []);

  const doAdd = (a: { link: string; title?: string; category?: string }) => {
    setBusyText(t('add.wait'));
    c.add({ link: a.link, title: a.title, category: a.category }).then(
      (tt) => {
        // the category is OMP's own choice here: the automatic check (on a later refresh) may correct it
        recordAutoCategory(tt.hash, a.category || '');
        if (!alive.current) return;
        toast(t('add.added', { title: tt.title || a.title || tt.hash }));
        replaceRoute({ name: 'torrent', hash: tt.hash });
      },
      (e) => {
        if (!alive.current) return;
        setBusy(false);
        toast(errorMessage(e), 'error');
      },
    );
  };

  const add = (a: { link: string; title?: string; category?: string }) => {
    if (busy) return;
    const l = a.link.trim();
    if (!l) {
      toast(t('add.enterLink'), 'error');
      return;
    }
    setBusy(true);
    doAdd({ link: l, title: a.title, category: a.category });
  };

  const askLink = () => {
    if (busy) return;
    askText(t('search.linkButton'), '', t('common.add')).then((v) => {
      if (alive.current && v !== null) add({ link: v });
    });
  };

  // a phone row asks the phone for its link (nnmclub, rutracker: the release page; a .torrent-only release fails)
  const addResult = (r: TvResult) => {
    if (busy) return;
    const key = resultKey(r);
    setBusy(true);
    setBusyText(t('search.resolving'));
    resolveTvResult(r).then(
      (l) => {
        if (!alive.current) return;
        doAdd({ link: l, title: r.Title, category: mapSearchCategory(r.Categories) });
      },
      (e) => {
        if (!alive.current) return;
        setBusy(false);
        const msg = resolveError(e);
        const next: { [key: string]: string } = {};
        Object.keys(rowErr).forEach((k) => {
          next[k] = rowErr[k];
        });
        next[key] = msg;
        setRowErr(next);
        toast(msg, 'error');
      },
    );
  };

  const sync = (h: Handle) => {
    if (!alive.current || handle.current !== h) return;
    setRows(h.results());
    const reasons = h.failures ? phoneReasons(h.failures()) : [];
    const explained = reasons.map((r) => r.id);
    const failed = h.failed().filter((id) => id !== 'phone' && explained.indexOf(id) < 0);
    setProg({ answered: h.answered().length, total: h.sourceIds.length, pending: h.pending(), failed: failed, reasons: reasons });
    // the phone stopped answering mid-search: TorrServer took over
    const lost = h.failures ? h.failures().some((f) => f.id === 'phone') : false;
    if (lost) {
      setNote('phoneDown');
      setBy('torrserver');
    }
  };

  const begin = (h: Handle) => {
    handle.current = h;
    order.current = [];
    sync(h);
    h.done.then(() => {
      if (!alive.current || handle.current !== h) return;
      sync(h);
      if (!h.results().length) toast(t('catalog.nothingFound'));
    });
  };

  // asked: the sites whose visible Cloudflare check this search (and its retries) has already opened
  const searchUnified = (q: string, asked: CheckedHosts = {}) => {
    stop();
    const raw = searchAll(q, {
      ctx: tvSourceContext(),
      onResult: () => sync(h),
      onDone: (id, err) => {
        sync(h);
        // a site behind Cloudflare wants a person: the dialog opens, the search runs again once it is passed
        if (err) {
          onSearchFailure(id, err, asked, () => {
            if (alive.current && handle.current === h) searchUnified(q, asked);
          });
        }
      },
    });
    // a site that ignores the query (its latest list) brings nothing on the screen
    const h: Handle = {
      sourceIds: raw.sourceIds,
      results: () => relevantRows(raw.results(), q),
      pending: () => raw.pending(),
      answered: () => raw.answered(),
      failed: () => raw.failed(),
      done: raw.done,
      cancel: () => raw.cancel(),
    };
    begin(h);
  };

  // the names the phone gives its sites: asked once a phone search runs, again on the next search after a failure
  const askNames = () => {
    if (namesAsked.current || !phoneLink.value) return;
    namesAsked.current = true;
    phoneRpc<unknown>('sources').then(
      (r) => {
        const list = r && typeof r === 'object' ? (r as { sources?: unknown }).sources : null;
        if (!Array.isArray(list)) return;
        rememberSourceNames(list.filter((x) => !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.name === 'string'));
        if (alive.current) setNamesRev((n) => n + 1);
      },
      () => {
        namesAsked.current = false;
      },
    );
  };

  const searchTv = (q: string) => {
    stop();
    const mine = seq.current;
    setRows(null);
    setProg(null);
    setNote('');
    setBy(phoneLink.value ? 'phone' : 'torrserver');
    setStarting(true);
    startTvSearch(q).then((start) => {
      if (!alive.current || seq.current !== mine) {
        start.handle.cancel();
        return;
      }
      setStarting(false);
      setNote(start.note);
      setBy(start.handle.by);
      if (start.handle.by === 'phone' && !start.note) askNames();
      const h = start.handle;
      unsub.current = h.subscribe(() => sync(h));
      begin(h);
    });
  };

  const search = (text?: string) => {
    if (busy) return;
    const q = (typeof text === 'string' ? text : query).trim();
    if (!q) return;
    setRowErr({});
    if (unified) searchUnified(q);
    else searchTv(q);
  };

  const pickSort = () => {
    const opts: { label: string; value: TvSortKey }[] = [{ label: t('search.sortByQuality'), value: 'quality' }];
    const labels: { [k: string]: string } = {};
    sortLabels().forEach((s) => {
      labels[s.key] = s.label;
    });
    (['seeds', 'size', 'date'] as SortKey[]).forEach((k) => opts.push({ label: labels[k], value: k }));
    choose(t('add.sort'), opts, sortKey).then((v) => {
      if (!alive.current || v === null) return;
      order.current = [];
      setSortKey(v);
    });
  };

  const sortName = (): string => {
    if (sortKey === 'quality') return t('search.sortQuality');
    const l = sortLabels().filter((s) => s.key === sortKey)[0];
    const label = l ? l.label : sortKey;
    return label.charAt(0).toLowerCase() + label.slice(1);
  };

  const streaming = !!prog && prog.pending.length > 0;
  const pickKind = (f: KindFilter) => {
    if (f === kindF) return;
    setKindFilter(f);
    order.current = [];
    setKindF(f);
  };
  // a release of unknown kind shows only under «Все»
  const pool = rows ? filterByKind(rows, kindF) : null;
  const sorted = pool ? (streaming ? stableTvOrder(order.current, pool, sortKey) : sortTvResults(pool, sortKey)) : [];
  order.current = sorted.map(resultKey);
  // the focused row left the list (a phone row TorrServer also found, after the fallback): the cursor goes to the row
  // now at its place, or to the search line when the list is empty (applied after the commit, below)
  const curFocus = getCurrentFocusKey() || '';
  if (curFocus.indexOf('res-') === 0) {
    const gone = curFocus.slice(4);
    const at = shown.current.indexOf(gone);
    if (at >= 0 && order.current.indexOf(gone) < 0) refocus.current = at;
  }
  shown.current = order.current;
  useEffect(() => {
    const at = refocus.current;
    if (at < 0) return;
    refocus.current = -1;
    const list = order.current;
    if (!list.length) setFocus('add-query');
    else setFocus('res-' + list[Math.min(at, list.length - 1)]);
  });
  // the full sort when streaming ends can move the focused row: keep it on screen
  useEffect(() => {
    if (streaming) return;
    const fk = getCurrentFocusKey() || '';
    if (fk.indexOf('res-') !== 0) return;
    const nodes = document.querySelectorAll('.search-result');
    for (let i = 0; i < nodes.length; i++) if (nodes[i].getAttribute('data-fk') === fk) scrollIntoViewSafe(nodes[i]);
  }, [streaming]);

  // blue on a row: the release details
  useKeys((a) => {
    if (a !== 'blue' || details) return false;
    const fk = getCurrentFocusKey() || '';
    if (fk.indexOf('res-') !== 0) return false;
    const r = sorted.filter((x) => 'res-' + resultKey(x) === fk)[0];
    if (!r) return false;
    setDetails(r);
    return true;
  });

  const closeDetails = () => {
    const r = details;
    setDetails(null);
    if (r && doesFocusableExist('res-' + resultKey(r))) setFocus('res-' + resultKey(r));
  };

  const blocked = unified && prog ? prog.failed.filter((id) => isCloudflare((getHealth(id) || { message: '' }).message)) : [];
  // a site that showed its code page: its message, and where to enter the code (no browser on the TV)
  const banned = unified && prog ? prog.failed.map(ipBanNote).filter((x) => !!x) : [];

  const inLibrary: { [hash: string]: boolean } = {};
  torrents.value.forEach((x) => {
    if (x.hash) inLibrary[x.hash.toLowerCase()] = true;
  });

  const phoneName = phoneLink.value ? phoneLink.value.name : '';
  const byText = by === 'sources' ? t('search.bySources') : by === 'phone' ? t('search.byPhone', { name: phoneName }).trim() : t('search.byTorrServer');
  const focusIdx = focusedKey ? order.current.indexOf(focusedKey) : -1;

  return (
    <FocusGroup focusKey="ADD" className="screen add search-screen">
      <h1>{t('add.findRelease')}</h1>
      <div class="search-top">
        <TextInput focusKey="add-query" value={query} onChange={setQuery} placeholder={t('add.queryPlaceholder')} onSubmit={() => search()} />
        <Button focusKey="add-go" className="primary" label={t('add.go')} onPress={() => search()} disabled={busy} />
        <Button focusKey="add-link" label={t('search.linkButton')} onPress={askLink} disabled={busy} />
        <Button focusKey="add-sources" label={t('search.sources')} onPress={() => navigate({ name: 'sources' })} />
      </div>
      {note === 'phoneDown' && <div class="search-note search-note-warn">{t('search.phoneDown')}</div>}
      {note === 'noPhone' && !unified && <div class="search-note">{t('search.noPhone')}</div>}
      {(prog || starting) && (
        <div class="search-status">
          <div class="search-status-text">
            <span class="search-by">{byText + (prog ? ' · ' : '…')}</span>
            {prog && (
              <span class="search-progress">
                {prog.total
                  ? progressText({
                      found: sorted.length,
                      answered: prog.answered,
                      total: prog.total,
                      pending: prog.pending.map(sourceName),
                      failed: prog.failed.map(sourceName),
                    })
                  : t('add.noSources')}
              </span>
            )}
          </div>
          {prog && (
            <FocusGroup focusKey="SEARCH-KIND" className="disc-kinds search-kinds" preferredChildFocusKey={'search-kind-' + kindF}>
              {kindFilterOptions().map((o) => (
                <Focusable
                  key={o.id}
                  focusKey={'search-kind-' + o.id}
                  className={'disc-kind' + (kindF === o.id ? ' active' : '')}
                  onPress={() => pickKind(o.id)}
                >
                  {o.label}
                </Focusable>
              ))}
            </FocusGroup>
          )}
          {prog && <Button focusKey="search-sort" className="search-sort" label={t('search.sortLabel', { v: sortName() })} onPress={pickSort} />}
        </div>
      )}
      {prog && prog.reasons.length > 0 && (
        <div class="search-note search-note-warn" data-hint="phone-sites">
          {tvGlyphs(prog.reasons.map(reasonText).join(' · '))}
        </div>
      )}
      {blocked.length > 0 && (
        <div class="search-progress search-hint">
          {cloudflareTvNote(blocked.map(sourceName))}
        </div>
      )}
      {banned.length > 0 && (
        <div class="search-progress search-hint" data-hint="ipban">
          {banned.join('; ') + '. ' + ipBanTvHint()}
        </div>
      )}
      {busy && (
        <div class="search-busy" role="status">
          <Spinner text={busyText} />
        </div>
      )}
      {rows && !sorted.length && (kindF === 'all' || !rows.length) && prog && prog.total > 0 && !prog.pending.length && <div class="search-note" data-hint="nothing">{t('catalog.nothingFound')}</div>}
      {rows && rows.length > 0 && !sorted.length && kindF !== 'all' && <div class="search-note" data-hint="no-kind">{t('search.kind.none')}</div>}
      {rows && (
        <FocusGroup focusKey="ADD-RESULTS" className="search-results">
          {sorted.map((r, i) => {
            const key = resultKey(r);
            const s = releaseTitle(r.Title);
            const chips = releaseChips(r.Title);
            const kind = resultKindLabel(r);
            const hash = (r.hash || r.Hash || '').toLowerCase();
            const also = r.sources && r.sources.length ? t('search.alsoOn', { list: r.sources.map(sourceName).join(', ') }) : '';
            const want = i < POSTER_FIRST || (focusIdx >= 0 && Math.abs(i - focusIdx) <= POSTER_NEAR);
            return (
              // focus key from the row identity, not its place: rows stream in and the cursor must stay on its row
              <Focusable key={key} focusKey={'res-' + key} className="list-item search-result" onPress={() => addResult(r)} onFocused={() => setFocusedKey(key)}>
                <Thumb title={r.Title} want={want} />
                <div class="search-main">
                  <div class="search-line1">
                    <span class="title">{tvGlyphs(s.title)}</span>
                    {s.meta && <span class="search-meta">{' · ' + tvGlyphs(s.meta)}</span>}
                    {kind && <span class="search-chip search-kind">{tvGlyphs(kind)}</span>}
                    {chips.map((ch) => (
                      <span key={ch} class={'search-chip' + (isHotChip(ch) ? ' hot' : '')}>
                        {ch}
                      </span>
                    ))}
                  </div>
                  <div class="search-raw">{tvGlyphs(r.Title)}</div>
                  {rowErr[key] && <div class="search-row-error" role="alert">{rowErr[key]}</div>}
                </div>
                <div class="search-side">
                  <div class="search-size">{[resultSizeText(r), '↑' + (r.Seed || 0)].filter(Boolean).join(' · ')}</div>
                  <div class="search-src">
                    <span class="src-badge">{tvGlyphs(sourceBadge(r))}</span>
                    {also && <span class="search-also">{also}</span>}
                  </div>
                  {hash && inLibrary[hash] && <div class="search-inlib">{t('search.inLibrary')}</div>}
                </div>
              </Focusable>
            );
          })}
        </FocusGroup>
      )}
      <div class="hints">{t('search.hints')}</div>
      {details && (
        <DetailsDialog
          r={details}
          onClose={closeDetails}
          onAdd={() => {
            const r = details;
            closeDetails();
            addResult(r);
          }}
        />
      )}
    </FocusGroup>
  );
}
