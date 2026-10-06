// TV "New" tab: the findings OMP on the phone made (new episodes of library series, better quality of library films,
// subscription releases). The TV keeps nothing itself: the feed, the links and the seen marks are the phone's. OK on a
// row watches (the link is asked of the phone, the release is added to TorrServer, the torrent screen opens on Watch);
// a better-quality finding asks Replace / Add alongside / Cancel. Chromium 53 safe.
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { t, tp, type Key } from '../../i18n';
import { ru } from '../../i18n/ru';
import { en } from '../../i18n/en';
import { client } from '../../store/servers';
import { torrents, refreshTorrents } from '../../store/library';
import { errorMessage } from '../../api/http';
import { mapSearchCategory } from '../../lib/category';
import { recordAutoCategory } from '../../lib/categoryCheck';
import { shortTitle } from '../../lib/libraryView';
import { FocusGroup, Focusable, Button, Spinner } from '../../ui/components';
import { choose } from '../../ui/dialog';
import { askText } from '../../ui/TextDialog';
import { SourceSwitch } from '../../ui/SourceSwitch';
import { toast } from '../../ui/toast';
import { useKeys } from '../../ui/keys';
import { navigate } from '../../ui/nav';
import { tvGlyphs } from '../../ui/tvText';
import { phoneLink, type PhoneLink } from '../../phone/phoneStore';
import { PhoneRpcError } from '../../phone/rpc';
import { fromRpcResult, type TvResult } from '../../phone/phoneSearch';
import {
  phoneFeed,
  phoneFindingLink,
  phoneFindingsSeen,
  phoneSubs,
  phoneSubCheck,
  phoneSubSet,
  phoneSubRemove,
  newsUnseen,
} from '../../phone/monitor';
import type { RpcFinding, RpcSub } from '../../phone/rpcTypes';
import { replaceWithLink } from '../../monitor/replaceTv';
import { failureOf } from '../../monitor/upgradeText';
import { isHotChip, releaseChips, releaseTitle } from '../../sources/releaseRow';
import { resultSizeText } from '../../sources/resultSize';
import { sourceBadge } from '../../sources/view';

export type NewsSeg = 'feed' | 'subs';

/** The segment of the tab: the findings, or the subscriptions (Task 4). Kept while the app runs. */
export const newsSeg = signal<NewsSeg>('feed');

/** The feed is asked again this often while the tab is shown. */
export const NEWS_REFRESH_MS = 60000;

type Status = 'checking' | 'online' | 'offline' | 'error';

/** A finding with its row as the TV search shows it. */
export interface NewsRow {
  f: RpcFinding;
  r: TvResult;
}

function pad(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** The second line of a row: what was found. */
export function kindLine(f: RpcFinding): string {
  if (f.kind === 'episodes' && f.episodes) {
    const e = f.episodes;
    const s = 'S' + pad(e.season || 0);
    if (e.from !== undefined && e.from < e.to) return t('tv.news.episodes', { code: s + 'E' + pad(e.from) + '-E' + pad(e.to) });
    return t('tv.news.episode', { code: s + 'E' + pad(e.to) });
  }
  if (f.kind === 'better' && f.better) {
    const unknown = t('torrent.better.unknown');
    return t('tv.news.better', { from: f.better.have || unknown, to: f.better.got || unknown });
  }
  return t('tv.news.sub', { name: tvGlyphs(f.title || '') });
}

/** The feed as rows, newest first; malformed findings are dropped. */
export function newsRows(list: unknown): NewsRow[] {
  if (!Array.isArray(list)) return [];
  const out: NewsRow[] = [];
  list.forEach((f: RpcFinding) => {
    if (!f || typeof f !== 'object' || typeof f.subId !== 'string' || typeof f.key !== 'string' || !f.key) return;
    if (f.kind !== 'episodes' && f.kind !== 'better' && f.kind !== 'sub') return;
    if (f.kind === 'better' && (!f.better || typeof f.better.torrentHash !== 'string')) return;
    const r = fromRpcResult(f.result, 'news');
    if (r) out.push({ f: f, r: r });
  });
  return out.sort((a, b) => (b.f.at || 0) - (a.f.at || 0));
}

const FILE_ONLY = ['sources.tvFileOnly', ru.sources.tvFileOnly, en.sources.tvFileOnly];

/** The message for a finding whose link or add failed: the phone's own words where it gave them. */
export function newsError(e: unknown): string {
  if (e instanceof PhoneRpcError) {
    if (e.code === 'timeout' || e.code === 'unreachable' || e.code === 'not_ready') return t('search.phoneSlow');
    const msg = (e.message || '').trim();
    if (FILE_ONLY.indexOf(msg) >= 0) return t('sources.tvFileOnly');
    if (msg) return tvGlyphs(msg);
    return t('sources.cannotGetLink');
  }
  return errorMessage(e) || t('sources.cannotGetLink');
}

/** The phone answered nothing (as opposed to answering with an error of its own). */
function isDown(e: unknown): boolean {
  if (!(e instanceof PhoneRpcError)) return true;
  return e.code === 'unreachable' || e.code === 'timeout' || e.code === 'not_ready' || e.code === 'nophone';
}

/** The phone name in a text: no double or dangling spaces when it is empty. */
function named(key: Key, name: string): string {
  return t(key, { name: tvGlyphs(name) }).replace(/\s+/g, ' ').trim();
}

const rowKey = (f: RpcFinding) => 'news-' + f.subId + '-' + f.key;
const SEG_KEYS: { [s in NewsSeg]: string } = { feed: 'news-seg-feed', subs: 'news-seg-subs' };

/** The focusable is in the document now (a row, a button or a dialog option). */
function onScreen(key: string): boolean {
  if (typeof document === 'undefined') return false;
  const list = document.querySelectorAll('[data-fk]');
  for (let i = 0; i < list.length; i++) if (list[i].getAttribute('data-fk') === key) return true;
  return false;
}

// the last feed per phone: back from the torrent screen the rows are there at once, and focus returns to its row
let cached: { url: string; rows: NewsRow[] } | null = null;

function cachedFor(link: PhoneLink | null): NewsRow[] | null {
  return link && cached && cached.url === link.url ? cached.rows : null;
}

/** Test seam: forgets the kept feed. */
export function resetNewsCache(): void {
  cached = null;
  subsCached = null;
}

/** Marks the unseen findings among `rows` seen on the phone (one call per subscription). */
function markSeen(rows: NewsRow[]): void {
  const by: { [subId: string]: string[] } = {};
  const order: string[] = [];
  rows.forEach((x) => {
    if (x.f.seen) return;
    if (!by[x.f.subId]) {
      by[x.f.subId] = [];
      order.push(x.f.subId);
    }
    by[x.f.subId].push(x.f.key);
  });
  if (!order.length) return;
  newsUnseen.value = 0;
  order.forEach((id) => {
    phoneFindingsSeen(id, by[id]).catch(() => undefined);
  });
}

type BetterChoice = 'replace' | 'add' | 'cancel';

export interface NewsTvProps {
  /** Focus moved to an element of the tab. */
  onFocused?: () => void;
  /** Back: leave the tab for the library. */
  onBack: () => void;
}

export function NewsTv(p: NewsTvProps) {
  const link = phoneLink.value;
  const seg = newsSeg.value;
  const [rows, setRows] = useState<NewsRow[] | null>(() => cachedFor(link));
  const [status, setStatus] = useState<Status>('checking');
  const [errText, setErrText] = useState('');
  // the Retry button stays (and keeps the focus) while the phone is asked again
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState('');
  const [rowErr, setRowErr] = useState<{ [key: string]: string }>({});
  const busyRef = useRef(false);
  const alive = useRef(true);
  const seq = useRef(0);

  const load = () => {
    const l = phoneLink.value;
    if (!l) return;
    const my = ++seq.current;
    // a refresh keeps the rows and the status line as they are until the phone answers
    setStatus((s) => (s === 'online' ? s : 'checking'));
    phoneFeed().then(
      (feed) => {
        if (!alive.current || my !== seq.current) return;
        setRetrying(false);
        const next = newsRows(feed ? feed.findings : null);
        cached = { url: l.url, rows: next };
        setRows(next);
        setStatus('online');
        markSeen(next);
      },
      (e) => {
        if (!alive.current || my !== seq.current) return;
        setRetrying(false);
        if (isDown(e)) {
          setStatus('offline');
          return;
        }
        setErrText(newsError(e));
        setStatus('error');
      },
    );
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // a new phone (or the same one forgotten) starts over; the feed is asked on open and every minute
  useEffect(() => {
    seq.current++;
    setRows(cachedFor(link));
    setRowErr({});
    setRetrying(false);
    if (!link) {
      setStatus('checking');
      return;
    }
    load();
    const timer = setInterval(load, NEWS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [link]);

  const shown = link && seg === 'feed' && (status === 'online' || status === 'checking') && rows ? rows : [];

  // focus is never lost: a row that went away (a refresh, offline, a forgotten phone) hands it to what is on screen now
  useEffect(() => {
    let cur = '';
    try {
      cur = getCurrentFocusKey() || '';
    } catch (e) {
      cur = '';
    }
    if (!cur || onScreen(cur)) return;
    const first = shown.length ? rowKey(shown[0].f) : '';
    const fallback = first || (onScreen('news-retry') ? 'news-retry' : SEG_KEYS[seg]);
    if (onScreen(fallback)) setFocus(fallback);
  });

  useKeys((a) => {
    if (a === 'back') {
      p.onBack();
      return true;
    }
    return false;
  });

  const fail = (x: NewsRow, msg: string) => {
    busyRef.current = false;
    if (!alive.current) return;
    setBusy('');
    const next: { [key: string]: string } = {};
    Object.keys(rowErr).forEach((k) => {
      next[k] = rowErr[k];
    });
    next[rowKey(x.f)] = msg;
    setRowErr(next);
    toast(msg, 'error');
  };

  /** Asks the phone for the link, adds the release and opens it (focus on Watch). */
  const watch = (x: NewsRow, category?: string) => {
    const c = client.value;
    if (!c) {
      toast(t('errors.noServerSelected'), 'error');
      return;
    }
    busyRef.current = true;
    setBusy(t('search.resolving'));
    phoneFindingLink(x.f.subId, x.f.key)
      .then((l) => {
        if (alive.current) setBusy(t('add.wait'));
        return c.add({ link: l, title: x.r.Title, category: category || mapSearchCategory(x.r.Categories) });
      })
      .then(
        (tt) => {
          // the category is OMP's own choice here: the automatic check (on a later refresh) may correct it
          if (!category) recordAutoCategory(tt.hash, mapSearchCategory(x.r.Categories));
          busyRef.current = false;
          markSeen([x]);
          void refreshTorrents(c).catch(() => undefined);
          toast(t('add.added', { title: tvGlyphs(tt.title || shortTitle(x.r.Title) || tt.hash) }));
          if (!alive.current) return;
          setBusy('');
          navigate({ name: 'torrent', hash: tt.hash });
        },
        (e) => fail(x, newsError(e)),
      );
  };

  /** Replaces the library torrent with the better release (the phone gives the link). */
  const replace = (x: NewsRow) => {
    const c = client.value;
    const b = x.f.better;
    if (!c || !b) {
      toast(t('errors.noServerSelected'), 'error');
      return;
    }
    busyRef.current = true;
    setBusy(t('search.resolving'));
    phoneFindingLink(x.f.subId, x.f.key).then(
      (l) => {
        if (alive.current) setBusy(t('monitor.replaceSheet.busy'));
        return replaceWithLink(c, b.torrentHash, x.r, l).then((res) => {
          busyRef.current = false;
          if (!res.ok) {
            if (res.cause === 'cancelled') {
              if (alive.current) setBusy('');
              return;
            }
            fail(x, tvGlyphs(failureOf(res, x.r).text));
            return;
          }
          markSeen([x]);
          toast(t('monitor.replaceSheet.replaced', { title: tvGlyphs(shortTitle(x.r.Title)) }));
          if (!alive.current) return;
          setBusy('');
          navigate({ name: 'torrent', hash: res.hash });
        });
      },
      (e) => fail(x, newsError(e)),
    );
  };

  const better = (x: NewsRow) => {
    const b = x.f.better;
    if (!b) return;
    const unknown = t('torrent.better.unknown');
    const key = rowKey(x.f);
    choose<BetterChoice>(t('tv.better.ask', { from: b.have || unknown, to: b.got || unknown }), [
      { label: t('monitor.replaceSheet.replace'), value: 'replace' },
      { label: t('tv.better.addNear'), value: 'add' },
      { label: t('common.cancel'), value: 'cancel' },
    ]).then((v) => {
      if (!alive.current) return;
      if (v === 'replace') replace(x);
      else if (v === 'add') {
        const old = torrents.value.filter((y) => (y.hash || '').toLowerCase() === b.torrentHash.toLowerCase())[0];
        watch(x, old && old.category ? old.category : undefined);
      }
      // the dialog is gone: the cursor goes back to its row
      if (onScreen(key)) setFocus(key);
    });
  };

  const open = (x: NewsRow) => {
    if (busyRef.current) return;
    if (x.f.kind === 'better') better(x);
    else watch(x);
  };

  const retry = () => {
    setRetrying(true);
    load();
  };

  const pill = status === 'online' ? 'ok' : status === 'offline' ? 'bad' : 'muted';
  const pillText = status === 'online' ? t('phoneSources.online') : status === 'offline' ? t('phoneSources.offline') : t('phoneSources.checking');

  const onRow = () => {
    if (p.onFocused) p.onFocused();
  };

  let body;
  if (!link) {
    body = (
      <div class="news-card">
        <div class="news-card-text">{t('tv.news.noPhone')}</div>
      </div>
    );
  } else if (seg === 'subs') {
    body = <SubsTv link={link} onFocused={onRow} />;
  } else if (status === 'offline' || status === 'error' || retrying) {
    body = (
      <div class="news-card">
        <div class="news-card-text src-note-bad">{status === 'error' ? errText : t('phoneSources.down')}</div>
        <FocusGroup focusKey="NEWS-RETRY" className="actions">
          <Button focusKey="news-retry" label={t('phoneSources.retry')} onPress={retry} onFocused={onRow} />
        </FocusGroup>
      </div>
    );
  } else if (!rows) {
    body = <Spinner text={t('tv.news.loading')} />;
  } else if (!rows.length) {
    body = <div class="empty">{t('tv.news.empty')}</div>;
  } else {
    body = (
      <FocusGroup focusKey="NEWS-LIST" className="news-list search-results">
        {shown.map((x) => {
          const key = rowKey(x.f);
          const s = releaseTitle(x.r.Title);
          const chips = releaseChips(x.r.Title);
          return (
            <Focusable key={key} focusKey={key} className="list-item search-result news-row" onPress={() => open(x)} onFocused={onRow}>
              <div class="search-main">
                <div class="search-line1">
                  {!x.f.seen && <span class="news-dot" aria-label={t('tv.news.newMark')} />}
                  <span class="title">{tvGlyphs(s.title)}</span>
                  {s.meta && <span class="search-meta">{' · ' + tvGlyphs(s.meta)}</span>}
                  {chips.map((ch) => (
                    <span key={ch} class={'search-chip' + (isHotChip(ch) ? ' hot' : '')}>
                      {ch}
                    </span>
                  ))}
                </div>
                <div class={'news-kind news-kind-' + x.f.kind}>{kindLine(x.f)}</div>
                {rowErr[key] && <div class="search-row-error" role="alert">{rowErr[key]}</div>}
              </div>
              <div class="search-side">
                <div class="search-size">{[resultSizeText(x.r), '↑' + (x.r.Seed || 0)].filter(Boolean).join(' · ')}</div>
                <div class="search-src">
                  <span class="src-badge">{tvGlyphs(sourceBadge(x.r))}</span>
                </div>
                {!x.f.seen && <div class="news-new">{t('tv.news.newMark')}</div>}
              </div>
            </Focusable>
          );
        })}
      </FocusGroup>
    );
  }

  return (
    <div class="news">
      <div class="news-head">
        <FocusGroup focusKey="NEWS-SEG" className="disc-kinds news-segs" preferredChildFocusKey={SEG_KEYS[seg]}>
          {(['feed', 'subs'] as NewsSeg[]).map((id) => (
            <Focusable
              key={id}
              focusKey={SEG_KEYS[id]}
              className={'disc-kind' + (seg === id ? ' active' : '')}
              onPress={() => { newsSeg.value = id; }}
              onFocused={() => { newsSeg.value = id; onRow(); }}
            >
              {id === 'feed' ? t('tv.news.findings') : t('tv.news.subs')}
            </Focusable>
          ))}
        </FocusGroup>
        <div class="spacer" />
        {link && (
          <div class="news-phone">
            <span class="news-phone-name">{named('tv.news.phone', link.name) + ' · '}</span>
            <span class={'news-phone-state src-note-' + pill}>{pillText}</span>
          </div>
        )}
      </div>
      {busy && (
        <div class="search-busy" role="status">
          <Spinner text={busy} />
        </div>
      )}
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Subscriptions: the phone's subscriptions. The switches and the buttons act on the phone at once; Check now
// starts a check there and the list is asked again while any check runs.

/** How often the list is asked again while a check runs, and for how long at most. Mutable for tests. */
export const subsPoll = { gapMs: 2000, maxMs: 60000 };

// the last list per phone: back on the segment the rows are there at once
let subsCached: { url: string; subs: RpcSub[] } | null = null;

function subsFor(link: PhoneLink | null): RpcSub[] | null {
  return link && subsCached && subsCached.url === link.url ? subsCached.subs : null;
}

/** The subscriptions the phone gave, malformed ones dropped. */
export function subsRows(list: unknown): RpcSub[] {
  if (!Array.isArray(list)) return [];
  return list.filter((x: RpcSub) => !!x && typeof x === 'object' && typeof x.id === 'string' && !!x.id && typeof x.query === 'string');
}

/** Lower case, yo as ye: the filter matches a query with yo typed with ye. */
function foldText(s: string): string {
  return (s || '').toLowerCase().replace(/\u0451/g, '\u0435');
}

/** The subscriptions whose query has `q` in it (case-insensitive, yo = ye). */
export function filterSubs(list: RpcSub[], q: string): RpcSub[] {
  const f = foldText(q.trim());
  if (!f) return list;
  return list.filter((x) => foldText(x.query).indexOf(f) >= 0);
}

/** 4K, 1080p, 720p, or any quality. */
export function subQuality(q: RpcSub['quality']): string {
  if (q === '2160') return '4K';
  if (q === '1080' || q === '720') return q + 'p';
  return t('tv.subs.anyQuality');
}

type SubPart = 'notify' | 'better' | 'check' | 'remove';
const subKey = (id: string, part: SubPart) => 'news-sub-' + id + '-' + part;
const FIND_KEY = 'news-subs-find';
const SUBS_RETRY = 'news-subs-retry';

function SubsTv(p: { link: PhoneLink; onFocused: () => void }) {
  const [subs, setSubs] = useState<RpcSub[] | null>(() => subsFor(p.link));
  const [status, setStatus] = useState<Status>('checking');
  const [errText, setErrText] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [filter, setFilter] = useState('');
  const alive = useRef(true);
  const seq = useRef(0);
  const list = useRef<RpcSub[] | null>(subs);
  const poll = useRef<{ timer: ReturnType<typeof setTimeout> | null; until: number }>({ timer: null, until: 0 });
  // where the focus goes once the list is drawn (after a remove)
  const focusNext = useRef('');

  const put = (next: RpcSub[]) => {
    list.current = next;
    subsCached = { url: p.link.url, subs: next };
    setSubs(next);
  };

  const stopPoll = () => {
    if (poll.current.timer) clearTimeout(poll.current.timer);
    poll.current.timer = null;
  };

  const anyChecking = (l: RpcSub[]) => l.some((x) => !!x.checking);

  function schedule() {
    if (poll.current.timer || !alive.current) return;
    poll.current.timer = setTimeout(tick, subsPoll.gapMs);
  }

  function tick() {
    poll.current.timer = null;
    if (!alive.current) return;
    phoneSubs().then(
      (got) => {
        if (!alive.current) return;
        const next = subsRows(got);
        put(next);
        if (anyChecking(next) && Date.now() < poll.current.until) schedule();
      },
      () => {
        if (alive.current && Date.now() < poll.current.until) schedule();
      },
    );
  }

  /** Asks the list again every 2 s while a check runs, for a minute at most. */
  const startPoll = () => {
    poll.current.until = Date.now() + subsPoll.maxMs;
    schedule();
  };

  const load = () => {
    const my = ++seq.current;
    setStatus((s) => (s === 'online' ? s : 'checking'));
    phoneSubs().then(
      (got) => {
        if (!alive.current || my !== seq.current) return;
        setRetrying(false);
        const next = subsRows(got);
        put(next);
        setStatus('online');
        if (anyChecking(next)) startPoll();
      },
      (e) => {
        if (!alive.current || my !== seq.current) return;
        setRetrying(false);
        if (isDown(e)) {
          setStatus('offline');
          return;
        }
        setErrText(newsError(e));
        setStatus('error');
      },
    );
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopPoll();
    };
  }, []);

  // a new phone starts over
  useEffect(() => {
    seq.current++;
    stopPoll();
    const c = subsFor(p.link);
    list.current = c;
    setSubs(c);
    setRetrying(false);
    load();
  }, [p.link.url]);

  const down = status === 'offline' || status === 'error' || retrying;
  const shown = subs && !down ? filterSubs(subs, filter) : [];

  // focus is never lost: after a remove it goes where the remove said, otherwise to what is on screen now
  // (setFocus is queued: the target is kept until the focus is on screen again, so a render in between cannot
  // send it to the first row instead)
  useEffect(() => {
    let cur = '';
    try {
      cur = getCurrentFocusKey() || '';
    } catch (e) {
      cur = '';
    }
    const want = focusNext.current;
    if (want) {
      if ((cur && onScreen(cur)) || !onScreen(want)) focusNext.current = '';
      else {
        setFocus(want);
        return;
      }
    }
    if (!cur || onScreen(cur)) return;
    let fallback = SEG_KEYS.subs;
    if (shown.length) fallback = subKey(shown[0].id, 'notify');
    else if (onScreen(SUBS_RETRY)) fallback = SUBS_RETRY;
    else if (onScreen(FIND_KEY)) fallback = FIND_KEY;
    if (onScreen(fallback)) setFocus(fallback);
  });

  const replaceSub = (sub: RpcSub) => {
    put((list.current || []).map((x) => (x.id === sub.id ? sub : x)));
  };

  const current = (id: string): RpcSub | undefined => (list.current || []).filter((x) => x.id === id)[0];

  const toggle = (s: RpcSub, what: 'notify' | 'better') => {
    const patch: { notify?: boolean; better?: boolean } = {};
    patch[what] = !s[what];
    phoneSubSet(s.id, patch).then(
      (sub) => {
        if (!alive.current) return;
        if (sub && typeof sub.id === 'string') {
          replaceSub(sub);
          return;
        }
        const cur = current(s.id);
        if (!cur) return;
        const copy: RpcSub = { ...cur };
        copy[what] = !s[what];
        replaceSub(copy);
      },
      (e) => toast(newsError(e), 'error'),
    );
  };

  const check = (s: RpcSub) => {
    if (s.checking) return;
    phoneSubCheck(s.id).then(
      () => {
        if (!alive.current) return;
        const cur = current(s.id);
        if (cur) replaceSub({ ...cur, checking: true });
        startPoll();
      },
      (e) => toast(newsError(e), 'error'),
    );
  };

  const remove = (s: RpcSub) => {
    const name = tvGlyphs(s.query);
    choose<boolean>(t('tv.subs.removeAsk', { name: name }), [
      { label: t('tv.subs.remove'), value: true },
      { label: t('common.cancel'), value: false },
    ]).then((ok) => {
      if (!ok || !alive.current) return;
      phoneSubRemove(s.id).then(
        () => {
          if (!alive.current) return;
          // the next row of the list as shown, else the one before, else the segment chip
          const vis = filterSubs(list.current || [], filter);
          let at = -1;
          vis.forEach((x, i) => {
            if (x.id === s.id) at = i;
          });
          const near = at >= 0 ? vis[at + 1] || vis[at - 1] : undefined;
          focusNext.current = near ? subKey(near.id, 'notify') : SEG_KEYS.subs;
          put((list.current || []).filter((x) => x.id !== s.id));
          toast(t('tv.subs.removed', { name: name }));
        },
        (e) => toast(newsError(e), 'error'),
      );
    });
  };

  const find = () => {
    askText(t('tv.subs.find'), filter, t('add.search')).then((v) => {
      if (v === null || !alive.current) return;
      setFilter(v.trim());
    });
  };

  const retry = () => {
    setRetrying(true);
    load();
  };

  if (down) {
    return (
      <div class="news-card">
        <div class="news-card-text src-note-bad">{status === 'error' ? errText : t('phoneSources.down')}</div>
        <FocusGroup focusKey="NEWS-SUBS-RETRY" className="actions">
          <Button focusKey={SUBS_RETRY} label={t('phoneSources.retry')} onPress={retry} onFocused={p.onFocused} />
        </FocusGroup>
      </div>
    );
  }
  if (!subs) return <Spinner text={t('tv.news.loading')} />;
  if (!subs.length) return <div class="empty news-subs-empty">{t('tv.subs.empty')}</div>;

  const sw = (s: RpcSub, what: 'notify' | 'better') => (
    <Focusable
      focusKey={subKey(s.id, what)}
      className="news-sub-switch"
      role="button"
      ariaLabel={t(what === 'notify' ? 'tv.subs.notify' : 'tv.subs.better')}
      ariaChecked={s[what]}
      onPress={() => toggle(s, what)}
      onFocused={p.onFocused}
    >
      <span class="news-sub-label">{t(what === 'notify' ? 'tv.subs.notify' : 'tv.subs.better')}</span>
      <SourceSwitch on={s[what]} />
    </Focusable>
  );

  return (
    <div class="news-subs">
      <FocusGroup focusKey="NEWS-SUBS-FIND" className="news-subs-top">
        <Button
          focusKey={FIND_KEY}
          icon="search"
          label={filter ? t('tv.subs.findValue', { q: tvGlyphs(filter) }) : t('tv.subs.find')}
          onPress={find}
          onFocused={p.onFocused}
        />
      </FocusGroup>
      {!shown.length && <div class="empty">{t('tv.subs.noMatch', { q: tvGlyphs(filter) })}</div>}
      <FocusGroup focusKey="NEWS-SUBS" className="news-subs-list">
        {shown.map((s) => (
          <div key={s.id} class="news-sub" data-sub={s.id}>
            <div class="news-sub-info">
              <div class="news-sub-line1">
                <span class="title">{tvGlyphs(s.query)}</span>
                <span class="search-chip">{subQuality(s.quality)}</span>
              </div>
              {s.unseen > 0 && <div class="news-new news-sub-fresh">{tp('tv.subs.fresh', s.unseen)}</div>}
            </div>
            <FocusGroup focusKey={'NEWS-SUB-' + s.id} className="news-sub-actions">
              {sw(s, 'notify')}
              {sw(s, 'better')}
              <Button
                focusKey={subKey(s.id, 'check')}
                className={s.checking ? 'news-sub-checking' : ''}
                label={s.checking ? t('tv.subs.checking') : t('tv.subs.check')}
                onPress={() => check(s)}
                onFocused={p.onFocused}
              />
              <Button focusKey={subKey(s.id, 'remove')} className="danger" label={t('tv.subs.remove')} onPress={() => remove(s)} onFocused={p.onFocused} />
            </FocusGroup>
          </div>
        ))}
      </FocusGroup>
    </div>
  );
}
