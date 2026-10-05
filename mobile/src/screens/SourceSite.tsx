import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';
import { goBack } from '../nav';
import { native } from '../platform/native';
import { phoneSourceContext } from '../searchContext';
import { errorMessage } from '../../../src/api/http';
import { log } from '../../../src/lib/log';
import { getSource } from '../../../src/sources/registry';
import { clearHealth, isCloudflareBypassOn, isSourceOn, onCloudflareBypassChange, setCloudflareBypass, setHealth, setSourceOn } from '../../../src/sources/store';
import { BYPASS_LABEL, BYPASS_WARNING, clearanceText } from '../../../src/sources/cloudflareCheck';
import { LOGIN_SITES, SESSION_SITES, transferLogins, transferSessions } from '../../../src/sources/transfer';
import { BROWSER_DONE_TITLE, browserSuggestion } from '../../../src/sources/browserLogin';
import { BrowserLoginButton } from '../ui/BrowserLoginButton';
import { allSources } from '../../../src/sources/registry';
import type { Source, SourceContext } from '../../../src/sources/types';
import { activeTv, isAtv } from '../tv/tvStore';
import { holdSignInScreen } from '../cloudflare';
import { CLOUDFLARE_NOT_SENT, sendTransfer, sessionsText, SESSIONS_NOT_SENT, siteLoginsText, SITES_NOT_SENT } from './Sources';

export const SITE_LOGIN_NOTE = 'Без входа сайт не отдаёт .torrent. Пароль хранится в зашифрованном хранилище телефона.';
export const SEND_LOGIN = 'Передать вход на телевизор';

/** The toast after «Передать вход на телевизор». */
function sentLoginText(name: string, result: string | undefined, notes: string[]): string {
  const head = result === 'ok' ? 'Вход на ' + name + ' передан на телевизор' : '';
  return [head].concat(notes).filter((x) => x).join('. ');
}

/**
 * «Вход на …» of a site behind a login (mockup PhoneSite): login and password, «Войти»; when signed in «Выйти». The
 * password is never kept in component state: read from the field at «Войти», handed to the source (Keystore only) and
 * the field is emptied right away. «Передать вход на телевизор» sends only this site's login to the paired Android TV.
 */
function SiteLogin({ source, ctx }: { source: Source; ctx: () => SourceContext }) {
  const [logged, setLogged] = useState<boolean | null>(null);
  // the current login is a browser session («Вход выполнен в браузере», no password)
  const [browser, setBrowser] = useState(false);
  const [suggest, setSuggest] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const pass = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const clearPassword = () => {
    if (pass.current) pass.current.value = '';
  };

  useEffect(() => {
    alive.current = true;
    if (source.loggedIn) {
      source.loggedIn(ctx()).then(
        (v) => alive.current && setLogged(v),
        () => alive.current && setLogged(false),
      );
    } else setLogged(false);
    if (source.browserSession) {
      source.browserSession(ctx()).then(
        (v) => alive.current && setBrowser(v),
        () => undefined,
      );
    }
    return () => {
      alive.current = false;
      clearPassword();
    };
  }, [source.id]);

  const submit = (e?: Event) => {
    if (e) e.preventDefault();
    if (busy || !source.login) return;
    const u = username.trim();
    const p = pass.current ? pass.current.value : '';
    if (!u || !p) {
      setError('Введите логин и пароль');
      return;
    }
    setError('');
    setSuggest('');
    setBusy(true);
    source.login(u, p, ctx()).then(
      () => {
        clearPassword();
        if (!alive.current) return;
        setBusy(false);
        setLogged(true);
        setBrowser(false);
        setUsername('');
        // signed in: the site takes part in the search; its real state comes with the next search
        setSourceOn(source.id, true);
        clearHealth(source.id);
      },
      (err) => {
        clearPassword();
        if (!alive.current) return;
        setBusy(false);
        setError(errorMessage(err));
        // a captcha or a Cloudflare check: «Войти через браузер» is suggested right under the form
        setSuggest(browserSuggestion(err));
      },
    );
  };

  const browserDone = () => {
    clearPassword();
    if (!alive.current) return;
    setLogged(true);
    setBrowser(true);
    setError('');
    setSuggest('');
    setUsername('');
    setSourceOn(source.id, true);
    clearHealth(source.id);
  };

  const logout = () => {
    if (!source.logout) return;
    source.logout(ctx()).then(
      () => {
        if (!alive.current) return;
        setLogged(false);
        setBrowser(false);
        setHealth(source.id, { state: 'login', at: Date.now() });
      },
      (e) => showToast(errorMessage(e)),
    );
  };

  const tv = activeTv.value;
  const canSend = !!logged && (browser ? SESSION_SITES : LOGIN_SITES).indexOf(source.id) >= 0 && !!tv && isAtv(tv) && !!tv.token;

  const send = () => {
    if (sending) return;
    setSending(true);
    // a browser session: its cookies are added natively; a password login: the login itself
    const prepared = browser
      ? transferSessions(allSources(), ctx(), [source.id]).then((sessions) => {
          if (!sessions[source.id]) throw new Error('Не удалось прочитать вход на ' + source.name);
          return sendTransfer(null, [], {}, { list: [source], flare: null }, sessions);
        })
      : transferLogins(allSources(), ctx(), [source.id]).then((logins) => {
          if (!logins[source.id]) throw new Error('Не удалось прочитать вход на ' + source.name);
          // only the login and this site's own switches: the other switches and FlareSolverr stay as they are on the TV
          return sendTransfer(null, [], logins, { list: [source], flare: null });
        });
    prepared
      .then(
        ({ r, droppedNote, cloudflareDropped, sitesDropped, sessionsDropped }) => {
          const result = browser ? (r.sessions ? r.sessions[source.id] : undefined) : r.logins ? r.logins[source.id] : undefined;
          log(result === 'ok' ? 'info' : 'warn', 'tv', 'Вход на ' + source.id + ' передан на Android TV: ' + (result || 'нет ответа'));
          if (alive.current) setSending(false);
          const notes = [
            droppedNote,
            sitesDropped ? SITES_NOT_SENT : '',
            cloudflareDropped ? CLOUDFLARE_NOT_SENT : '',
            sessionsDropped ? SESSIONS_NOT_SENT : '',
            siteLoginsText(r.logins, () => source.name),
            sessionsText(r.sessions, () => source.name),
          ];
          showToast(sentLoginText(source.name, result, notes) || 'Передано', 6000);
        },
        (e) => {
          const msg = errorMessage(e);
          log('warn', 'tv', 'Передача входа на Android TV: ' + msg);
          if (alive.current) setSending(false);
          showToast(msg, 6000);
        },
      );
  };

  const title = 'Вход на ' + source.name;
  return (
    <>
      <section class="m-set-group">
        <form class="m-set-card" data-site-card="login" onSubmit={submit}>
          <div class="m-sheet-title">{title}</div>
          <div class="m-note m-muted">{SITE_LOGIN_NOTE}</div>
          {logged ? (
            <div class="m-src-row">
              <span class="m-src-name">
                <span>{browser ? BROWSER_DONE_TITLE : 'Вход выполнен'}</span>
              </span>
              <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={logout}>
                Выйти
              </button>
            </div>
          ) : (
            <>
              <div class="m-field">
                <label for="m-site-user">Логин</label>
                <input
                  id="m-site-user"
                  name="username"
                  class="m-input"
                  type="text"
                  autocomplete="username"
                  autocapitalize="off"
                  value={username}
                  onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="m-field">
                <label for="m-site-pass">Пароль</label>
                <input id="m-site-pass" name="password" class="m-input" type="password" autocomplete="current-password" ref={pass} />
              </div>
              {error && (
                <div class="m-error" role="alert">
                  {error}
                </div>
              )}
              <button type="submit" class="m-btn m-btn-primary" disabled={busy || logged === null}>
                {busy ? 'Вхожу…' : 'Войти'}
              </button>
              <BrowserLoginButton source={source} ctx={ctx} suggest={suggest} disabled={busy || logged === null} onDone={browserDone} />
            </>
          )}
        </form>
      </section>
      {canSend && (
        <button type="button" class="m-btn m-btn-secondary" data-send="site-login" disabled={sending} onClick={send}>
          {sending ? 'Передаю…' : SEND_LOGIN}
        </button>
      )}
    </>
  );
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} class={'m-switch' + (on ? ' on' : '')} onClick={onToggle}>
      <span class="m-switch-knob" />
    </button>
  );
}

/**
 * A site behind Cloudflare (mockup PhoneSite): «Искать на …», «Обходить проверку Cloudflare» with the clearance time and
 * the warning, then the site's login block (sites that need one). clearance / now / ctx: fakes in tests.
 */
export function SourceSite({
  id,
  clearance = (url: string) => native.cloudflareClearance(url),
  now = Date.now,
  ctx = phoneSourceContext,
}: {
  id: string;
  clearance?: (url: string) => Promise<number | null>;
  now?: () => number;
  ctx?: () => SourceContext;
}) {
  const [, setTick] = useState(0);
  const [until, setUntil] = useState<number | null>(null);
  const source = getSource(id);
  // the phone listens to the TV's «Войти на телефоне» while this screen is open (and a while after)
  useEffect(() => holdSignInScreen(), []);

  useEffect(() => {
    let alive = true;
    const off = onCloudflareBypassChange(() => alive && setTick((n) => n + 1));
    if (source && source.siteUrl) {
      clearance(source.siteUrl).then(
        (u) => alive && setUntil(u),
        () => undefined,
      );
    }
    return () => {
      alive = false;
      off();
    };
  }, [id]);

  // the status goes away when the clearance ends, with the screen open
  useEffect(() => {
    if (until === null) return undefined;
    const left = until - now();
    if (left <= 0) return undefined;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(left + 500, 2147483000));
    return () => clearTimeout(timer);
  }, [until]);

  if (!source) {
    return (
      <div class="m-screen" data-route="sourceSite">
        <div class="m-bar">
          <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
            <Icon d="M15 5l-7 7 7 7" />
          </button>
          <h1 class="m-bar-title">Источник</h1>
        </div>
        <div class="m-note m-muted">Источник не найден</div>
      </div>
    );
  }

  const on = isSourceOn(source);
  const bypass = isCloudflareBypassOn(source);
  const status = bypass ? clearanceText(until, now()) : null;
  const searchLabel = 'Искать на ' + source.name;

  return (
    <div class="m-screen" data-route="sourceSite">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">{source.name}</h1>
      </div>
      <section class="m-set-group">
        <div class="m-set-card" data-site-card="cloudflare">
          <div class="m-src-row">
            <span class="m-src-name">
              <span>{searchLabel}</span>
            </span>
            <Switch
              on={on}
              label={searchLabel}
              onToggle={() => {
                setSourceOn(source.id, !on);
                setTick((n) => n + 1);
              }}
            />
          </div>
          {source.cloudflare === true && (
            <>
              <div class="m-src-row" data-bypass={bypass ? 'on' : 'off'}>
                <span class="m-src-name">
                  <span>{BYPASS_LABEL}</span>
                  {status && <span class="m-src-note ok">{status}</span>}
                </span>
                <Switch on={bypass} label={BYPASS_LABEL} onToggle={() => setCloudflareBypass(source.id, !bypass)} />
              </div>
              <div class="m-cf-warn" data-note="cloudflare-warning">
                {BYPASS_WARNING}
              </div>
            </>
          )}
        </div>
      </section>
      {source.needsLogin && source.login && <SiteLogin source={source} ctx={ctx} />}
    </div>
  );
}
