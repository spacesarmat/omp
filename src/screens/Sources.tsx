import { useEffect, useState } from 'preact/hooks';
import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Focusable, Button } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { TrackerLoginDialog } from '../ui/TrackerLoginDialog';
import { errorMessage } from '../api/http';
import { log } from '../lib/log';
import { builtinSources, torrServerSources } from '../sources/registry';
import { clearHealth, getHealth, isSourceOn, onHealthChange, setHealth, setSourceOn } from '../sources/store';
import { forgetSiteLogin, forgetTransferredLogin, lastTransfer, LOGIN_SITES, onTransferApplied, siteLoginFromPhone, transferWhen } from '../sources/transfer';
import { tvSourceContext } from '../sources/tvContext';
import { healthText, type HealthLine } from '../sources/view';
import { browserDone, browserDoneTitle } from '../sources/browserLogin';
import { indexerConnections, INDEXER_SOURCE_PREFIX, onIndexersChange, torznabHiddenText, type IndexerConn } from '../sources/indexerStore';
import { checkedText, connLine, connTitle, getIndexerStatus, onIndexerStatus, refreshIndexerStatus, trackerStateText, trackerTone } from '../sources/indexerStatus';
import type { SourceContext } from '../sources/types';
import { hostName, readTorznabImports } from '../sources/indexerDiscovery';
import { client } from '../store/servers';
import { nativeClearance, nativeScanLan } from '../platform/androidNative';
import { bypassWarning, runCloudflareCheck, tvSiteNote } from '../sources/cloudflareCheck';
import { isCfInteractiveMessage } from '../sources/cloudflare';
import { isCloudflareBypassOn, onCloudflareBypassChange, setCloudflareBypass } from '../sources/store';
import { flareSolverrUrl, onFlareChange } from '../sources/flareStore';
import { flareStatus, onFlareStatus, tvFlareLines, tvFlareRefresh } from '../sources/flaresolverr';
import type { FlareStatus } from '../sources/flaresolverr';
import type { LanScan } from '../sources/indexerDiscovery';
import type { Source } from '../sources/types';
import { t } from '../i18n';

/** Names of the TorrServer sources (as on the phone). */
const tsLabels = (): { [id: string]: string } => ({
  'ts-rutor': t('tvSources.tsRutor'),
  'ts-torznab': 'Jackett / Prowlarr (Torznab)',
});

export const intro = () => t('tvSources.intro');

export const phoneHow = () => t('tvSources.phoneHow');

export const noIndexers = () => t('tvSources.noIndexers');

function indexerSourceId(c: IndexerConn): string {
  return INDEXER_SOURCE_PREFIX + c.id;
}

function label(s: Source): string {
  return tsLabels()[s.id] || s.name;
}

function Switch(p: { on: boolean }) {
  return (
    <span class={'src-switch' + (p.on ? ' on' : '')}>
      <span class="src-switch-knob" />
    </span>
  );
}

function Note(p: { note: HealthLine | null }) {
  if (!p.note) return null;
  return <span class={'src-note src-note-' + p.note.tone}>{p.note.text}</span>;
}

/** FlareSolverr on the TV: the saved (or found on the LAN) address, its version and state (mockup 1, left). */
/** The address and the status come as props: a component that reads the language signal only re-renders on a prop change. */
function FlareBlock(props: { url: string | null; status: FlareStatus | null }) {
  const lines = tvFlareLines(props.url, props.status);
  return (
    <div class="src-flare" data-flare="">
      <div class="src-phone-title">FlareSolverr</div>
      {lines.where && <div class="src-flare-where">{lines.where}</div>}
      <div class={'src-flare-state src-note-' + lines.tone}>{lines.state}</div>
    </div>
  );
}

function TransferNote() {
  const last = lastTransfer();
  if (!last) return <div class="src-last muted">{t('tvSources.noTransfers')}</div>;
  const w = transferWhen(last.at);
  return <div class="src-last">{t('tvSources.lastTransfer', { day: w.day, time: w.time, phone: last.phone })}</div>;
}

/**
 * Android TV «Источники поиска» (mockup 1): Jackett / Prowlarr connections with their trackers, switches of every
 * source, rutracker «Войти» / «Выйти», how to send from the phone. ctx: the source context (tests pass fakes).
 */
/** The TorrServer settings reader for the Torznab path selection (tests pass a fake). */
export interface TorrServerSettings {
  read: () => Promise<unknown>;
  host: string;
}

function chosenServer(): TorrServerSettings | null {
  const c = client.value;
  return c ? { read: () => c.settingsQuiet(), host: hostName(c.baseUrl) } : null;
}

/** The LAN scan for FlareSolverr (tests pass a fake). */
function tvScan(): LanScan {
  return nativeScanLan;
}

export function SourcesScreen({
  ctx = tvSourceContext,
  now = Date.now,
  server = chosenServer,
  scan = tvScan,
  clearance = nativeClearance,
}: {
  ctx?: () => SourceContext;
  now?: () => number;
  server?: () => TorrServerSettings | null;
  scan?: () => LanScan | null;
  /** When the stored Cloudflare clearance of a site ends (tests pass a fake). */
  clearance?: (url: string) => Promise<number | null>;
} = {}) {
  const [, setTick] = useState(0);
  const rerender = () => setTick((n) => n + 1);
  const [logged, setLogged] = useState<{ [id: string]: boolean }>({});
  // the current login is a browser session («вход выполнен в браузере»)
  const [browser, setBrowser] = useState<{ [id: string]: boolean }>({});
  const [loginFor, setLoginFor] = useState<Source | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const ts = torrServerSources();
  // the Jackett / Prowlarr sources have their own group
  const builtins = builtinSources().filter((s) => s.kind !== 'indexer');
  const indexers = indexerConnections();
  // sites behind Cloudflare (Source.cloudflare) and when their clearance ends
  const cfSites = builtins.filter((s) => s.cloudflare === true);
  // the sites behind Cloudflare are listed once, in their own group (with their «Войти» / «Выйти»)
  const plain = builtins.filter((s) => s.cloudflare !== true);
  const [until, setUntil] = useState<{ [id: string]: number | null }>({});

  const readClearance = (alive: () => boolean) => {
    cfSites.forEach((s) => {
      if (!s.siteUrl) return;
      clearance(s.siteUrl).then(
        (u) => {
          if (alive()) setUntil((m) => ({ ...m, [s.id]: u }));
        },
        () => undefined,
      );
    });
  };

  const checkIndexers = () => {
    indexerConnections().forEach((c) => {
      refreshIndexerStatus(c, ctx(), now).then(undefined, () => undefined);
    });
  };

  const checkLogins = (alive: () => boolean) => {
    builtins
      .filter((s) => !!s.loggedIn)
      .forEach((s) => {
        s.loggedIn!(ctx()).then(
          (v) => {
            if (alive()) setLogged((m) => ({ ...m, [s.id]: v }));
          },
          () => {
            if (alive()) setLogged((m) => ({ ...m, [s.id]: false }));
          },
        );
        if (s.browserSession) {
          s.browserSession(ctx()).then(
            (v) => {
              if (alive()) setBrowser((m) => ({ ...m, [s.id]: v }));
            },
            () => undefined,
          );
        }
      });
  };

  useEffect(() => {
    let alive = true;
    const isAlive = () => alive;
    restoreFocus('src-first');
    const offHealth = onHealthChange(() => { if (alive) rerender(); });
    const offStatus = onIndexerStatus(() => { if (alive) rerender(); });
    const offConns = onIndexersChange(() => { if (alive) rerender(); });
    const offFlare = onFlareStatus(() => { if (alive) rerender(); });
    const offFlareUrl = onFlareChange(() => { if (alive) rerender(); });
    tvFlareRefresh(ctx().http, scan(), now);
    // a transfer from the phone may arrive while the screen is open
    const offTransfer = onTransferApplied(() => {
      if (!alive) return;
      rerender();
      checkLogins(isAlive);
      checkIndexers();
    });
    checkLogins(isAlive);
    checkIndexers();
    readClearance(isAlive);
    const offBypass = onCloudflareBypassChange(() => { if (alive) rerender(); });
    // the TorrServer Torznab hosts decide whether Torznab (TorrServer) is hidden
    const ts = server();
    readTorznabImports(ts ? ts.read : null, ts ? ts.host || undefined : undefined).then(() => {
      if (alive) rerender();
    });
    return () => {
      alive = false;
      offHealth();
      offTransfer();
      offStatus();
      offConns();
      offFlare();
      offFlareUrl();
      offBypass();
    };
  }, []);

  // a status «действует до …» goes away when its time comes, with the screen open
  useEffect(() => {
    const t = now();
    const next = Object.keys(until)
      .map((id) => until[id])
      .filter((u): u is number => typeof u === 'number' && u > t)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return undefined;
    const timer = setTimeout(rerender, Math.min(next - t + 500, 2147483000));
    return () => clearTimeout(timer);
  }, [until]);

  const needsCheck = (s: Source) => {
    const h = getHealth(s.id);
    return !!h && h.state === 'error' && isCfInteractiveMessage(h.message);
  };

  // OK on a site: the visible check when it waits for one, else the switch (turning it on shows the warning first)
  /** A site behind Cloudflare has one switch on the TV: search on it through the Cloudflare pass. */
  const siteOn = (s: Source) => isSourceOn(s) && isCloudflareBypassOn(s);

  const pressSite = (s: Source) => {
    const on = siteOn(s);
    if (on && needsCheck(s) && s.siteUrl) {
      runCloudflareCheck(s.name, s.siteUrl).then((r) => {
        // passed, or closed: either way the next OK is the switch again (it can be turned off)
        if (r === 'solved' || r === 'cancelled') clearHealth(s.id);
        if (r === 'solved') readClearance(() => true);
      });
      return;
    }
    if (on) {
      setSourceOn(s.id, false);
      setCloudflareBypass(s.id, false);
      return;
    }
    confirmDialog(bypassWarning(), t('tvSources.enable')).then((ok) => {
      if (!ok) return;
      setSourceOn(s.id, true);
      setCloudflareBypass(s.id, true);
    });
  };

  const toggle = (s: Source) => {
    setSourceOn(s.id, !isSourceOn(s));
    rerender();
  };

  const loggedIn = (s: Source) => !!logged[s.id];

  /** The site's current login came from the phone (LOGIN_SITES: their own note; rutracker: the last transfer). */
  const fromPhone = (s: Source) => {
    // a site's own note (its login, or a browser session from the phone)
    if (siteLoginFromPhone(s.id)) return true;
    if (LOGIN_SITES.indexOf(s.id) >= 0) return false;
    const t = lastTransfer();
    return !!t && t.rutracker;
  };

  const forgetFromPhone = (s: Source) => {
    forgetSiteLogin(s.id);
    if (LOGIN_SITES.indexOf(s.id) < 0) forgetTransferredLogin();
  };

  const noteOf = (s: Source): HealthLine | null => {
    if (s.needsLogin && s.login) {
      if (!loggedIn(s)) return { text: t('sources.state.login'), tone: 'muted' };
      const h = getHealth(s.id);
      if (!h) return { text: fromPhone(s) ? t('tvSources.loginFromPhone') : browser[s.id] ? browserDone() : t('tvSources.loggedInDone'), tone: 'ok' };
      return healthText(h);
    }
    if (!isSourceOn(s)) return { text: t('sources.state.off'), tone: 'muted' };
    return healthText(getHealth(s.id));
  };

  const focusLogin = (s: Source) => {
    const k = 'src-login-' + s.id;
    if (doesFocusableExist(k)) setFocus(k);
  };

  const logout = (s: Source) => {
    if (!s.logout) return;
    confirmDialog(t('tvSources.signOutAsk', { name: s.name }), t('tvSources.signOut')).then((ok) => {
      if (!ok || !s.logout) return;
      s.logout(ctx()).then(
        () => {
          setLogged((m) => ({ ...m, [s.id]: false }));
          setBrowser((m) => ({ ...m, [s.id]: false }));
          // an optional login (NNM-Club) leaves no «нужен вход» behind
          if (s.needsLogin) setHealth(s.id, { state: 'login', at: Date.now() });
          else clearHealth(s.id);
          forgetFromPhone(s);
          toast(t('tvSources.signedOut', { name: s.name }));
        },
        (e) => {
          log('warn', 'search', t('tvSources.logSignOutFailed'));
          toast(errorMessage(e), 'error');
        },
      );
    });
  };

  const loginDone = (s: Source, viaBrowser?: boolean) => {
    setLoginFor(null);
    setLogged((m) => ({ ...m, [s.id]: true }));
    setBrowser((m) => ({ ...m, [s.id]: !!viaBrowser }));
    // signed in: the source takes part in the search; its real state comes with the next search
    setSourceOn(s.id, true);
    clearHealth(s.id);
    // typed on the TV now: no longer «вход передан с телефона»
    forgetFromPhone(s);
    toast(viaBrowser ? browserDoneTitle() : t('tvSources.signedIn'));
    setTimeout(() => focusLogin(s), 0);
  };

  return (
    <FocusGroup focusKey="SOURCES" className="screen sources">
      <div class="src-layout">
        <div class="src-side">
          <h1>{t('tvSettings.sources')}</h1>
          <div class="src-intro">{intro()}</div>
          <FlareBlock url={flareSolverrUrl()} status={flareStatus()} />
          <div class="src-phone">
            <div class="src-phone-title">{t('tvSources.fromPhone')}</div>
            <div class="src-phone-text">{phoneHow()}</div>
            <TransferNote />
          </div>
        </div>
        <div class="src-list">
          {builtins.length > 0 && <div class="src-group">{t('tvSources.indexers')}</div>}
          {builtins.length > 0 && !indexers.length && <div class="src-empty">{noIndexers()}</div>}
          {indexers.map((c, i) => {
            const st = getIndexerStatus(c.id);
            const on = isSourceOn({ id: indexerSourceId(c) });
            const line = connLine(st, on);
            const open = openId === c.id;
            return (
              <div key={c.id} data-indexer={c.id}>
                <div class="src-line">
                  <Focusable
                    focusKey={i === 0 ? 'src-first' : 'src-idx-' + c.id}
                    className="src-row src-row-builtin"
                    onPress={() => {
                      setOpenId(open ? null : c.id);
                      // a row opened after more than a minute is checked again
                      if (!open && (!st || now() - st.at > 60000)) refreshIndexerStatus(c, ctx(), now).then(undefined, () => undefined);
                    }}
                  >
                    <span class="src-name">
                      {connTitle(c)}
                      <span class={'src-note src-note-' + line.tone}>
                        {st && (st.state === 'nokey' || st.state === 'badkey') ? t('tvSources.sendFromPhone', { text: line.text }) : line.text}
                      </span>
                    </span>
                    <span class="src-caret">{open ? '▴' : '▾'}</span>
                  </Focusable>
                  <Button
                    focusKey={'src-idx-on-' + c.id}
                    className="src-login"
                    label={on ? t('tvSources.on') : t('tvSources.off')}
                    onPress={() => {
                      setSourceOn(indexerSourceId(c), !on);
                      rerender();
                    }}
                  />
                </div>
                {open && (
                  <div class="src-trackers">
                    {st &&
                      st.trackers.map((t, k) => (
                        <Focusable key={k} focusKey={'src-trk-' + c.id + '-' + k} className="src-tracker" onPress={() => undefined}>
                          <span class="src-tracker-name">{t.name}</span>
                          <span class={'src-note-' + trackerTone(t)}>{trackerStateText(t, true)}</span>
                        </Focusable>
                      ))}
                    {st && st.hint && <div class="src-tracker-info">{st.hint}</div>}
                    {st && st.state !== 'ok' && st.message && <div class="src-tracker-info src-note-bad">{st.message}</div>}
                    {st && <div class="src-tracker-info">{checkedText(st.at, now())}</div>}
                  </div>
                )}
              </div>
            );
          })}
          <div class="src-group">{t('tvSources.viaTorrServer')}</div>
          {ts.map((s, i) => (
            <Focusable key={s.id} focusKey={i === 0 && !indexers.length ? 'src-first' : 'src-' + s.id} className="src-row" onPress={() => toggle(s)}>
              <span class="src-name">
                {label(s)}
                <Note note={healthText(getHealth(s.id))} />
              </span>
              <Switch on={isSourceOn(s)} />
            </Focusable>
          ))}
          {torznabHiddenText(!ts.some((s) => s.id === 'ts-torznab')) && <div class="src-empty">{torznabHiddenText(true)}</div>}
          {cfSites.length > 0 && <div class="src-group">{t('tvSources.cfSites')}</div>}
          {cfSites.map((s) => {
            const on = siteOn(s);
            const login = !!s.login;
            const base = tvSiteNote(isCloudflareBypassOn(s), needsCheck(s), until[s.id] === undefined ? null : until[s.id], now());
            let note = base;
            if (login && s.needsLogin && !loggedIn(s)) note = { text: t('sources.state.login'), tone: 'muted' };
            else if (!isSourceOn(s)) note = { text: t('sources.state.off'), tone: 'muted' };
            else if (!isCloudflareBypassOn(s)) note = { text: t('tvSources.cfNoBypass'), tone: 'muted' };
            // mockup: «обход Cloudflare · вход передан с телефона»
            else if (base.tone === 'ok' && login && fromPhone(s)) note = { text: base.text + ' · ' + t('tvSources.loginFromPhone'), tone: base.tone };
            return (
              <div class="src-line" key={'cf-' + s.id} data-cf-site={s.id} data-source={s.id}>
                <Focusable focusKey={'src-cf-' + s.id} className="src-row src-row-builtin" onPress={() => pressSite(s)}>
                  <span class="src-name">
                    {s.name}
                    <span class={'src-note src-note-' + note.tone}>{note.text}</span>
                  </span>
                  <span class={'src-act' + (on ? ' on' : '')}>{on ? t('tvSources.on') : t('tvSources.off')}</span>
                </Focusable>
                {login && (
                  <Button
                    focusKey={'src-login-' + s.id}
                    className="src-login"
                    label={loggedIn(s) ? t('tvSources.signOut') : t('common.signIn')}
                    onPress={() => (loggedIn(s) ? logout(s) : setLoginFor(s))}
                  />
                )}
              </div>
            );
          })}
          {plain.length > 0 && <div class="src-group">{t('tvSources.builtin')}</div>}
          {plain.map((s) => {
            const on = isSourceOn(s);
            const login = !!(s.needsLogin && s.login);
            return (
              <div class="src-line" key={s.id} data-source={s.id}>
                <Focusable focusKey={'src-' + s.id} className="src-row src-row-builtin" onPress={() => toggle(s)}>
                  <span class="src-name">
                    {s.name}
                    <Note note={noteOf(s)} />
                  </span>
                  <span class={'src-act' + (on ? ' on' : '')}>{on ? t('tvSources.on') : t('tvSources.off')}</span>
                </Focusable>
                {login && (
                  <Button
                    focusKey={'src-login-' + s.id}
                    className="src-login"
                    label={loggedIn(s) ? t('tvSources.signOut') : t('common.signIn')}
                    onPress={() => (loggedIn(s) ? logout(s) : setLoginFor(s))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {loginFor && (
        <TrackerLoginDialog
          source={loginFor}
          ctx={ctx}
          onClose={() => {
            const s = loginFor;
            setLoginFor(null);
            setTimeout(() => focusLogin(s), 0);
          }}
          onDone={(b) => loginDone(loginFor, b)}
        />
      )}
    </FocusGroup>
  );
}
