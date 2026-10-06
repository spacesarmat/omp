// The search sources screen on LG (mockup 7): the TV has no site parsers, the phone searches. The card shows the phone and
// whether it answers, the phone's sites come with their state and a switch (on/off goes to the phone), and the
// TorrServer sources (Rutor, Jackett) open their own screen. Only on/off and a state come over RPC: never a password,
// a cookie or the phone's token. Chromium 53 safe.
import { useEffect, useRef, useState } from 'preact/hooks';
import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Focusable, Button } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { navigate } from '../ui/nav';
import { tvGlyphs } from '../ui/tvText';
import { SourceSwitch } from '../ui/SourceSwitch';
import { phoneRpc, PhoneRpcError } from '../phone/rpc';
import { forgetPhoneLink, phoneLink, type PhoneLink } from '../phone/phoneStore';
import type { RpcSource, RpcSourceState } from '../phone/rpcTypes';
import { rememberSourceNames } from '../sources/sourceNames';
import { t, type Key } from '../i18n';

export type StateTone = 'ok' | 'warn' | 'bad' | 'off';

const MAX_ERROR = 80;

const STATE_TONE: { [k in RpcSourceState]: StateTone } = {
  ok: 'ok',
  loggedIn: 'ok',
  login: 'warn',
  cloudflare: 'warn',
  error: 'bad',
  off: 'off',
  unknown: 'off',
};

/** The coloured line under a phone site: its state in words and the tone of its colour. */
export function stateLine(s: RpcSource): { text: string; tone: StateTone } {
  const state: RpcSourceState = Object.prototype.hasOwnProperty.call(STATE_TONE, s.state) ? s.state : 'unknown';
  if (state === 'error') {
    const msg = tvGlyphs(typeof s.message === 'string' ? s.message.replace(/\s+/g, ' ').trim() : '');
    if (!msg) return { text: t('phoneSources.state.error'), tone: 'bad' };
    return { text: msg.length > MAX_ERROR ? msg.slice(0, MAX_ERROR - 1) + '…' : msg, tone: 'bad' };
  }
  return { text: t(('phoneSources.state.' + state) as Key), tone: STATE_TONE[state] };
}

const TONE_CLASS: { [k in StateTone]: string } = { ok: 'src-note-ok', warn: 'src-note-warn', bad: 'src-note-bad', off: 'src-note-muted' };

/** A text with a phone name that may be empty: no double or dangling spaces. */
function named(key: Key, name: string): string {
  return t(key, { name: tvGlyphs(name) })
    .replace(/\s+([?.,!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

type Status = 'checking' | 'online' | 'offline';

/** The phone answered nothing (as opposed to answering with an error of its own). */
function isDown(e: unknown): boolean {
  if (!(e instanceof PhoneRpcError)) return true;
  return e.code === 'unreachable' || e.code === 'timeout' || e.code === 'not_ready' || e.code === 'nophone';
}

function cleanList(v: unknown): RpcSource[] {
  const list = v && typeof v === 'object' ? (v as { sources?: unknown }).sources : null;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (s): s is RpcSource => !!s && typeof s === 'object' && typeof s.id === 'string' && !!s.id && typeof s.name === 'string' && typeof s.on === 'boolean',
  );
}

// the last list per phone: back from «Rutor, Jackett» the rows are there at once (and focus returns to its row)
let cached: { url: string; list: RpcSource[] } | null = null;

function cachedFor(link: PhoneLink | null): RpcSource[] | null {
  return link && cached && cached.url === link.url ? cached.list : null;
}

const TS_KEY = 'psrc-ts';
const GROUP_KEY = 'PHONE-SOURCES';

/** The focusable is in the document now (a screen row or a dialog option). */
function onScreen(key: string): boolean {
  if (typeof document === 'undefined') return false;
  const list = document.querySelectorAll('[data-fk]');
  for (let i = 0; i < list.length; i++) if (list[i].getAttribute('data-fk') === key) return true;
  return false;
}
const rowKey = (id: string) => 'psrc-' + id;

export function PhoneSourcesScreen() {
  const link = phoneLink.value;
  const [status, setStatus] = useState<Status>('checking');
  const [list, setList] = useState<RpcSource[] | null>(() => cachedFor(link));
  const [busy, setBusy] = useState<{ [id: string]: boolean }>({});
  // the Retry button stays (and keeps focus) while the phone is asked again
  const [retrying, setRetrying] = useState(false);
  const alive = useRef(true);
  const seq = useRef(0);
  // with no list yet, focus waits on «Rutor, Jackett»; the first list moves it to the first site (until a key press)
  const firstFocus = useRef(!(list && list.length));

  const load = () => {
    if (!phoneLink.value) return;
    const my = ++seq.current;
    const url = phoneLink.value.url;
    setStatus('checking');
    phoneRpc<unknown>('sources').then(
      (r) => {
        if (!alive.current || my !== seq.current) return;
        const next = cleanList(r);
        rememberSourceNames(next);
        cached = { url: url, list: next };
        setList(next);
        setStatus('online');
        setRetrying(false);
      },
      () => {
        if (!alive.current || my !== seq.current) return;
        setStatus('offline');
        setRetrying(false);
      },
    );
  };

  useEffect(() => {
    alive.current = true;
    restoreFocus(list && list.length ? rowKey(list[0].id) : TS_KEY);
    const onKey = () => {
      firstFocus.current = false;
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      alive.current = false;
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // a new phone (or the same one forgotten) starts over
  useEffect(() => {
    seq.current++;
    setList(cachedFor(link));
    setBusy({});
    setRetrying(false);
    if (link) load();
    else setStatus('checking');
  }, [link]);

  const rows = link && status !== 'offline' && list ? list : [];

  // focus is never lost: a row that went away (offline, forgotten phone) hands it to what is on screen now. The DOM is
  // asked, not the library: it adds and removes focusables a moment after the render.
  useEffect(() => {
    let cur = '';
    try {
      cur = getCurrentFocusKey() || '';
    } catch (e) {
      cur = '';
    }
    const first = rows.length ? rowKey(rows[0].id) : '';
    if (firstFocus.current && first && cur === TS_KEY) {
      firstFocus.current = false;
      setFocus(first);
      return;
    }
    if (cur && cur !== GROUP_KEY && onScreen(cur)) return;
    const fallback = first || (link && status === 'offline' ? 'psrc-retry' : TS_KEY);
    if (onScreen(fallback)) setFocus(fallback);
  });

  const retry = () => {
    setRetrying(true);
    load();
  };

  const toggle = (s: RpcSource) => {
    if (busy[s.id] || !link) return;
    const want = !s.on;
    const before = s;
    const optimistic: RpcSource = { id: s.id, name: s.name, on: want, state: want ? (s.state === 'off' ? 'unknown' : s.state) : 'off', message: s.message };
    const put = (v: RpcSource) =>
      setList((cur) => {
        const next = (cur || []).map((x) => (x.id === v.id ? v : x));
        if (link) cached = { url: link.url, list: next };
        return next;
      });
    put(optimistic);
    setBusy((m) => ({ ...m, [s.id]: true }));
    phoneRpc<{ on?: unknown }>('setSourceEnabled', { id: s.id, on: want }).then(
      (r) => {
        if (!alive.current) return;
        setBusy((m) => ({ ...m, [s.id]: false }));
        const on = r && typeof r.on === 'boolean' ? r.on : want;
        if (on !== want) put(before);
      },
      (e) => {
        if (!alive.current) return;
        setBusy((m) => ({ ...m, [s.id]: false }));
        put(before);
        toast(named('phoneSources.switchFailed', s.name), 'error');
        if (isDown(e)) setStatus('offline');
      },
    );
  };

  const forget = () => {
    const name = link ? link.name : '';
    confirmDialog(named('phoneSources.forgetAsk', name), t('phoneSources.forget')).then((ok) => {
      if (!ok) return;
      cached = null;
      forgetPhoneLink();
      setTimeout(() => {
        if (alive.current && onScreen(TS_KEY)) setFocus(TS_KEY);
      }, 0);
    });
  };

  const pill = status === 'online' ? 'ok' : status === 'offline' ? 'bad' : 'muted';
  const pillText = status === 'online' ? t('phoneSources.online') : status === 'offline' ? t('phoneSources.offline') : t('phoneSources.checking');

  return (
    <FocusGroup focusKey={GROUP_KEY} className="screen sources psrc">
      <div class="src-layout">
        <div class="src-side">
          <h1>{t('phoneSources.title')}</h1>
          {link ? (
            <div class="src-phone psrc-card">
              <div class="psrc-card-head">
                <div class="src-phone-title psrc-card-title">{named('phoneSources.card', link.name)}</div>
                <span class={'psrc-pill psrc-pill-' + pill}>{pillText}</span>
              </div>
              <div class="src-phone-text">{t('phoneSources.cardText')}</div>
              {(status === 'offline' || retrying) && (
                <div class="psrc-down">
                  <div class="psrc-down-text src-note-bad">{t('phoneSources.down')}</div>
                  <Button focusKey="psrc-retry" label={t('phoneSources.retry')} onPress={retry} />
                </div>
              )}
            </div>
          ) : (
            <div class="src-phone psrc-card psrc-card-none">
              <div class="src-phone-title">{t('phoneSources.none')}</div>
              <div class="src-phone-text">{t('phoneSources.noneText')}</div>
            </div>
          )}
        </div>
        <div class="src-list">
          {rows.length > 0 && <div class="src-group">{t('phoneSources.sites')}</div>}
          {rows.map((s) => {
            const line = stateLine(s);
            return (
              <div key={s.id} data-psrc={s.id}>
                <Focusable focusKey={rowKey(s.id)} className="src-row" onPress={() => toggle(s)}>
                  <span class="src-name">
                    {tvGlyphs(s.name)}
                    <span class={'src-note ' + TONE_CLASS[line.tone]}>{line.text}</span>
                  </span>
                  <SourceSwitch on={s.on} />
                </Focusable>
              </div>
            );
          })}
          <div class="src-group">{t('phoneSources.noPhone')}</div>
          <Focusable focusKey={TS_KEY} className="src-row" onPress={() => navigate({ name: 'tsSources' })}>
            <span class="src-name">
              {t('phoneSources.tsRow')}
              <span class="src-note src-note-muted">{t('phoneSources.tsText')}</span>
            </span>
            <span class="src-caret">{'▶'}</span>
          </Focusable>
          {link && (
            <div class="psrc-forget">
              <Button focusKey="psrc-forget" label={t('phoneSources.forget')} onPress={forget} />
            </div>
          )}
        </div>
      </div>
      <div class="hints">{t('phoneSources.hints')}</div>
    </FocusGroup>
  );
}
