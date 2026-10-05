import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { TrackerLogin } from '../ui/TrackerLogin';
import { showToast } from '../ui/toast';
import { goBack, navigate } from '../nav';
import { phoneSourceContext } from '../searchContext';
import { errorMessage } from '../../../src/api/http';
import { builtinSources, torrServerSources } from '../../../src/sources/registry';
import { clearHealth, getHealth, isSourceOn, onHealthChange, setCloudflareBypass, setHealth, setSourceOn } from '../../../src/sources/store';
import { cloudflareHint, healthText, ipBanNote, isCloudflare, withCloudflareNote, type CloudflareHint, type HealthLine } from '../../../src/sources/view';
import { browserFailed, hasBrowserLogin } from '../../../src/sources/browserLogin';
import { enterCodeText } from '../../../src/sources/ipBan';
import type { Source, SourceContext } from '../../../src/sources/types';
import { allSources } from '../../../src/sources/registry';
import { rutrackerSavedLogin } from '../../../src/sources/rutracker';
import {
  buildTransferPayload,
  LOGIN_SITES,
  transferIndexers,
  transferLogins,
  transferSessions,
  transferWhen,
  validateTransferPayload,
  validTransferLogin,
  withoutNewParts,
  type RutrackerResult,
  type TransferIndexer,
  type TransferLogin,
  type TransferPayload,
} from '../../../src/sources/transfer';
import { indexerConnections, onIndexersChange, torznabHiddenText, type IndexerConn } from '../../../src/sources/indexerStore';
import { IndexerSection, phoneIndexerEnv, type IndexerEnv } from './SourcesIndexers';
import { flareSolverrUrl, onFlareChange } from '../../../src/sources/flareStore';
import { flareStatus, onFlareStatus, phoneFlareNote, refreshFlareStatus } from '../../../src/sources/flaresolverr';
import { loadJson, saveJson, isObject } from '../../../src/store/storage';
import { log } from '../../../src/lib/log';
import { lang, t } from '../../../src/i18n';
import { activeTv, isAtv } from '../tv/tvStore';
import { holdSignInScreen } from '../cloudflare';
import { sendSourcesToTv, sessionIp, sourcesRejected, tvState, type SourcesSent } from '../tv/tvClient';

const SENT_KEY = 'tsp.sourcesSent';
const TV_ICON = 'M3 5h18v11H3zM8 20h8';

export const sendText = (): string => t('sources.send.text');

/** What the phone says after a transfer, by the TV's rutracker answer. */
export function sentText(r: RutrackerResult | undefined): string {
  if (r === 'bad_login') return t('sources.send.rutBadLogin');
  if (r === 'captcha') return t('sources.send.rutCaptcha');
  if (r === 'error') return t('sources.send.rutError');
  return t('sources.screen.sent');
}

/** The logins left out of a transfer: by site (too long, bad characters), or all of them when the body was too big. */
export function loginsNotSent(names: string[], tooBig: boolean): string {
  if (tooBig) return t('sources.send.loginsTooBig');
  return t('sources.send.loginsBad', { names: names.join(', ') });
}

export const loginNotSent = (): string => loginsNotSent(['rutracker'], false);
export const rutrackerNotStored = (): string => t('sources.send.rutrackerNotStored');

/** What the phone adds about each site's login the TV checked ('' when all were accepted). */
export function siteLoginsText(logins: { [site: string]: RutrackerResult } | undefined, nameOf: (id: string) => string): string {
  if (!logins) return '';
  return Object.keys(logins)
    .map((id) => {
      const n = nameOf(id);
      const r = logins[id];
      if (r === 'bad_login') return t('sources.send.siteBadLogin', { name: n });
      if (r === 'captcha') return t('sources.send.siteCaptcha', { name: n });
      if (r === 'error') return t('sources.send.siteError', { name: n });
      return '';
    })
    .filter((x) => x)
    .join('. ');
}

/** The checkbox of the logins that go with the transfer: «Вместе со входом на rutracker, Kinozal». */
export function withLoginsLabel(names: string[]): string {
  return t('sources.send.withLogins', { names: names.join(', ') });
}
export const indexersNotSent = (): string => t('sources.send.indexersNotSent');
export const cloudflareNotSent = (): string => t('sources.send.cloudflareNotSent');

/** What the phone adds when the TV saved fewer connections than were sent ('' when all or none were sent). */
export function indexersText(sent: number, saved: number | undefined): string {
  if (!sent || saved === undefined || saved >= sent) return '';
  return t('sources.send.indexersPartial', { saved: saved, sent: sent });
}
export const sourcesNotReady = (): string => t('sources.send.notReady');

export interface PreparedTransfer {
  payload: TransferPayload;
  /** Some login was left out (droppedLogins names them). */
  loginDropped: boolean;
  /** Source ids of the logins left out ('rutracker' included). */
  droppedLogins: string[];
  /** All logins were left out because the body was too big. */
  tooBig: boolean;
  indexersDropped: boolean;
}

/**
 * The payload the TV accepts (same schema as its control server). A login the TV would refuse is left out on its own,
 * so the other logins and the switches still go; only when the body is still too big are all logins left out.
 */
export function transferPayload(
  list: Source[],
  login: TransferLogin | null,
  indexers?: TransferIndexer[],
  flare: string | null = flareSolverrUrl(),
  logins?: { [id: string]: TransferLogin } | null,
): PreparedTransfer {
  const dropped: string[] = [];
  const rut = login && validTransferLogin(login) ? login : null;
  if (login && !rut) dropped.push('rutracker');
  const sites: { [id: string]: TransferLogin } = {};
  Object.keys(logins || {}).forEach((id) => {
    if (validTransferLogin(logins![id])) sites[id] = logins![id];
    else dropped.push(id);
  });
  const all = (login ? ['rutracker'] : []).concat(Object.keys(logins || {}));
  // the phone's resolved language goes with every variant: the TV stores it as its own
  const language = lang.value;
  const full = validateTransferPayload(buildTransferPayload(list, rut, indexers, flare, sites, language));
  if (full) return { payload: full, loginDropped: dropped.length > 0, droppedLogins: dropped, tooBig: false, indexersDropped: false };
  const noLogin = validateTransferPayload(buildTransferPayload(list, null, indexers, flare, null, language));
  if (noLogin) return { payload: noLogin, loginDropped: all.length > 0, droppedLogins: all, tooBig: all.length > dropped.length, indexersDropped: false };
  const bare = validateTransferPayload(buildTransferPayload(list, null, undefined, flare, null, language));
  if (!bare) throw new Error(sourcesNotReady());
  return { payload: bare, loginDropped: all.length > 0, droppedLogins: all, tooBig: all.length > dropped.length, indexersDropped: !!(indexers && indexers.length) };
}

/** The «not sent» note of a prepared transfer ('' when every login went). */
export function droppedText(p: { droppedLogins: string[]; tooBig: boolean }): string {
  return p.droppedLogins.length ? loginsNotSent(p.droppedLogins.map(nameOf), p.tooBig) : '';
}

/**
 * Sends the switches (and the given logins) to the paired TV; an older OMP there that refuses the v0.15 parts gets the
 * rest. Shared by «Передать на телевизор» and the site screen's «Передать вход на телевизор».
 */
export function sendTransfer(
  login: TransferLogin | null,
  indexers: TransferIndexer[],
  logins: { [id: string]: TransferLogin },
  /** The site screen sends only its own site's switches and no FlareSolverr address. */
  only?: { list: Source[]; flare: string | null },
  /** Sites signed in through the browser → their hosts: their sessions are added natively. */
  sessions?: { [id: string]: string[] },
): Promise<{
  r: SourcesSent;
  loginDropped: boolean;
  droppedNote: string;
  indexersDropped: boolean;
  cloudflareDropped: boolean;
  sitesDropped: boolean;
  sessionsDropped: boolean;
  sent: number;
}> {
  const p = only ? transferPayload(only.list, login, indexers, only.flare, logins) : transferPayload(allSources(), login, indexers, undefined, logins);
  const state = {
    loginDropped: p.loginDropped,
    droppedNote: droppedText(p),
    indexersDropped: p.indexersDropped,
    cloudflareDropped: false,
    sitesDropped: false,
    sessionsDropped: false,
    sent: p.payload.indexers ? p.payload.indexers.length : 0,
  };
  const withSessions = !!sessions && Object.keys(sessions).length > 0;
  const extras = !!(p.payload.indexers || p.payload.flaresolverr || p.payload.cloudflare || p.payload.logins) || withSessions;
  const rejected = (e: unknown) => e instanceof Error && e.message === sourcesRejected();
  // a v0.15 OMP on the TV refuses only the v0.16 language: the same transfer goes again without it
  const first = sendSourcesToTv(p.payload, withSessions ? sessions : undefined).catch((e: unknown) => {
    if (!p.payload.language || !rejected(e)) throw e;
    const rest: TransferPayload = { ...p.payload };
    delete rest.language;
    return sendSourcesToTv(rest, withSessions ? sessions : undefined);
  });
  return first
    .catch((e: unknown) => {
      // an older OMP on the TV refuses the v0.15 parts (connections, FlareSolverr, Cloudflare switches, site logins)
      if (!extras || !rejected(e)) throw e;
      if (state.sent) state.indexersDropped = true;
      if (p.payload.flaresolverr || p.payload.cloudflare) state.cloudflareDropped = true;
      if (p.payload.logins) state.sitesDropped = true;
      if (withSessions) state.sessionsDropped = true;
      state.sent = 0;
      return sendSourcesToTv(withoutNewParts(p.payload));
    })
    .then((r) => ({ r, ...state }));
}

export const sitesNotSent = (): string => t('sources.send.sitesNotSent');
export const sessionsNotSent = (): string => t('sources.send.sessionsNotSent');

/** What the phone adds about each browser session the TV checked ('' when all were kept). */
export function sessionsText(sessions: { [site: string]: string } | undefined, nameOf: (id: string) => string): string {
  if (!sessions) return '';
  return Object.keys(sessions)
    .map((id) => {
      const r = sessions[id];
      if (r === 'error') return t('sources.send.sessionError', { name: nameOf(id) });
      if (r === 'missing') return t('sources.send.sessionMissing', { name: nameOf(id) });
      return '';
    })
    .filter((x) => x)
    .join('. ');
}

/** The phone's saved login of every site in LOGIN_SITES among the given ids. */
function readSiteLogins(ctx: () => SourceContext, ids: string[]): Promise<{ [id: string]: TransferLogin }> {
  return ids.length ? transferLogins(allSources(), ctx(), ids).catch(() => ({})) : Promise.resolve({});
}

/** The phone's saved rutracker login, null when there is none or the storage fails. */
function readLogin(ctx: () => SourceContext): Promise<TransferLogin | null> {
  const s = ctx().secrets;
  return s ? rutrackerSavedLogin(s).catch(() => null) : Promise.resolve(null);
}

function lastSent(ip: string): number | null {
  const v = loadJson<unknown>(SENT_KEY, null, (x) => x === null || isObject(x));
  return isObject(v) && v.ip === ip && typeof v.at === 'number' ? v.at : null;
}

/** «Передать на телевизор»: only for a paired Android TV with OMP (LG has no built-in sources). */
function SendToTv({ loginNames, indexers, ctx }: { loginNames: { id: string; name: string }[]; indexers: IndexerConn[]; ctx: () => SourceContext }) {
  const hasLogin = loginNames.length > 0;
  const tv = activeTv.value;
  const [withLogin, setWithLogin] = useState(true);
  const [withKeys, setWithKeys] = useState(true);
  const hasKeys = indexers.some((c) => c.keySet);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, setTick] = useState(0);
  if (!tv || !isAtv(tv)) return null;
  // the TV forgot this phone (401 cleared the token): keep the card with the reason and a way to pair again
  const paired = !!tv.token;
  const connected = tvState.value === 'connected' && sessionIp.value === tv.ip;
  const at = lastSent(tv.ip);

  const send = () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const ip = tv.ip;
    const ids = loginNames.map((x) => x.id);
    const login = withLogin && ids.indexOf('rutracker') >= 0 ? readLogin(ctx) : Promise.resolve(null);
    const sites = withLogin ? readSiteLogins(ctx, ids.filter((id) => LOGIN_SITES.indexOf(id) >= 0)) : Promise.resolve({});
    // the keys are read from the Keystore storage only now, and live only in this request
    const conns = indexerConnections();
    const list = conns.length ? transferIndexers(conns, ctx().secrets, withKeys) : Promise.resolve([] as TransferIndexer[]);
    // sites signed in through the browser go as sessions (added natively)
    const ses = withLogin ? transferSessions(allSources(), ctx(), ids).catch(() => ({})) : Promise.resolve({});
    Promise.all([login, list, sites, ses])
      .then(([l, idx, s, b]) => sendTransfer(l, idx, s, undefined, b))
      .then(
        ({ r, droppedNote, indexersDropped, cloudflareDropped, sitesDropped, sessionsDropped, sent }) => {
          saveJson(SENT_KEY, { ip, at: Date.now() });
          const partial = indexersText(sent, r.indexers);
          const siteNotes = [siteLoginsText(r.logins, nameOf), sessionsText(r.sessions, nameOf)].filter((x) => x).join('. ');
          log(
            (r.rutracker && r.rutracker !== 'ok') || partial || siteNotes ? 'warn' : 'info',
            'tv',
            t('sources.send.logSent') +
              (r.rutracker ? t('log.sourcesRutrackerLogin', { res: r.rutracker }) : '') +
              Object.keys(r.logins || {}).map((id) => t('log.sourcesLogin', { id: id, res: r.logins![id] })).join('') +
              (sent ? t('log.sourcesIndexers', { saved: r.indexers || 0, sent: sent }) : ''),
          );
          setBusy(false);
          setTick((n) => n + 1);
          const notes = [
            droppedNote,
            r.rutrackerNotStored ? rutrackerNotStored() : '',
            indexersDropped ? indexersNotSent() : '',
            cloudflareDropped ? cloudflareNotSent() : '',
            sitesDropped ? sitesNotSent() : '',
            sessionsDropped ? sessionsNotSent() : '',
            partial,
            siteNotes,
          ].filter((x) => x);
          const head = notes.length && (!r.rutracker || r.rutrackerNotStored) ? t('sources.send.head') : sentText(r.rutracker);
          showToast(notes.length ? head + ' ' + notes.join('. ') : head, notes.length ? 6000 : undefined);
        },
        (e) => {
          const msg = errorMessage(e);
          log('warn', 'tv', t('sources.send.logFailed', { msg: msg }));
          setBusy(false);
          setError(msg);
        },
      );
  };

  const when = at ? transferWhen(at) : null;
  return (
    <section class="m-set-group" data-send="tv">
      <div class="m-set-card m-send-card">
        <div class="m-send-head">
          <Icon d={TV_ICON} size={22} />
          <span class="m-send-name">{t('sources.send.tvName', { name: tv.name })}</span>
          <span class={'m-send-state' + (connected && paired ? ' ok' : '')}>{connected && paired ? t('remote.atvState.connected') : t('remote.atvState.idle')}</span>
        </div>
        <div class="m-note m-muted">{sendText()}</div>
        {hasLogin && (
          <label class="m-send-check">
            <input type="checkbox" checked={withLogin} onChange={(e) => setWithLogin((e.target as HTMLInputElement).checked)} />
            {withLoginsLabel(loginNames.map((x) => x.name))}
          </label>
        )}
        {hasKeys && (
          <label class="m-send-check">
            <input type="checkbox" checked={withKeys} onChange={(e) => setWithKeys((e.target as HTMLInputElement).checked)} />
            {t('sources.send.withKeys')}
          </label>
        )}
        {paired ? (
          <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={send}>
            {busy ? t('sources.screen.sending') : t('sources.send.button')}
          </button>
        ) : (
          <button type="button" class="m-btn m-btn-secondary" onClick={() => navigate({ name: 'tv' })}>
            {t('remote.pairAgain')}
          </button>
        )}
        {error && (
          <div class="m-error" role="alert">
            {error}
          </div>
        )}
        {when && !error && <div class="m-send-done">{t('sources.send.sentOn', { day: when.day, time: when.time })}</div>}
      </div>
    </section>
  );
}

function nameOf(id: string): string {
  const s = allSources().filter((x) => x.id === id)[0];
  return s ? s.name : id;
}

/** Entry to the FlareSolverr screen with the saved address and its last check. */
function FlareEntry() {
  const note = phoneFlareNote(flareSolverrUrl(), flareStatus());
  return (
    <section class="m-set-group" data-entry="flaresolverr">
      <div class="m-set-label">{t('sources.screen.flareEntry')}</div>
      <button type="button" class="m-set-row m-set-row-btn" onClick={() => navigate({ name: 'flaresolverr' })}>
        <span class="m-src-name">
          <span>FlareSolverr</span>
          <span class={'m-src-note' + (note.tone === 'muted' ? '' : ' ' + note.tone)}>{note.text}</span>
        </span>
        <Icon d="M9 5l7 7-7 7" size={18} />
      </button>
    </section>
  );
}

/** Names of the TorrServer sources on this screen. */
function label(s: Source): string {
  if (s.id === 'ts-rutor') return t('tvSources.tsRutor');
  if (s.id === 'ts-torznab') return 'Jackett / Prowlarr (Torznab)';
  return s.name;
}

/** The FAQ question behind «Как» under a site Cloudflare stopped: Jackett and Prowlarr (FlareSolverr in them). */
export const CF_HOW_Q = 'jackett';

/** A status-line action («Войти», «Выйти», «Ввести код»): accent text with a 44px touch target. */
function StatusLink({ text, onPress, disabled, action }: { text: string; onPress: () => void; disabled?: boolean; action?: string }) {
  return (
    <>
      <span class="m-src-sep" aria-hidden="true">
        {' · '}
      </span>
      <button type="button" class="m-src-link" data-action={action} disabled={disabled} onClick={onPress}>
        {text}
      </button>
    </>
  );
}

/**
 * One row of «Источники поиска»: the name and its status line on the left; on the right only two fixed columns — the
 * optional › to the site's screen and the switch. «Войти» / «Выйти» / «Ввести код» are links at the end of the status line.
 */
function SourceRow({
  source,
  note,
  hint,
  login,
  code,
  onToggle,
  onOpen,
}: {
  source: Source;
  note: HealthLine | null;
  /** The site's own short hint when its last search hit Cloudflare (cloudflareHint). */
  hint?: CloudflareHint | null;
  login?: { loggedIn: boolean; onLogin: () => void; onLogout: () => void };
  /** The site showed its code page (ipBanNote): «Ввести код» opens it in the browser sheet. */
  code?: { busy: boolean; onPress: () => void };
  onToggle: () => void;
  /** A site with a login: its own screen (password login, «Передать вход на телевизор», the Cloudflare bypass switch). */
  onOpen?: () => void;
}) {
  const on = isSourceOn(source);
  const name = label(source);
  const links = [
    login ? (login.loggedIn ? <StatusLink key="out" text={t('tvSources.signOut')} onPress={login.onLogout} /> : <StatusLink key="in" text={t('common.signIn')} onPress={login.onLogin} />) : null,
    code ? <StatusLink key="code" action="enter-code" text={enterCodeText()} disabled={code.busy} onPress={code.onPress} /> : null,
  ].filter((x) => x);
  const status = !!note || links.length > 0;
  // the row and its hint are a column: the hint always starts below the row, whatever the height of the note
  return (
    <div class="m-src-item">
      <div class={'m-src-row' + (status ? ' with-status' : '')} data-source={source.id}>
        <span class="m-src-name">
          <span class="m-src-title">{name}</span>
          {status && (
            <span class="m-src-status">
              {note ? <span class={'m-src-note' + (note.tone === 'muted' ? '' : ' ' + note.tone)}>{note.text}</span> : null}
              {links}
            </span>
          )}
        </span>
        <span class="m-src-open">
          {onOpen && (
            <button type="button" class="m-icon-btn" aria-label={t('sources.screen.settingsOf', { name: name })} data-open={source.id} onClick={onOpen}>
              <Icon d="M9 5l7 7-7 7" size={18} />
            </button>
          )}
        </span>
        <button type="button" role="switch" aria-checked={on} aria-label={name} class={'m-switch' + (on ? ' on' : '')} onClick={onToggle}>
          <span class="m-switch-knob" />
        </button>
      </div>
      {hint && (
        <div class="m-src-hint" data-hint="cloudflare">
          <span>{hint.text}</span>
          {hint.how && (
            <button type="button" class="m-link" data-how={source.id} onClick={() => navigate({ name: 'faq', q: CF_HOW_Q })}>
              {t('sources.cfHint.how')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ctx: the source context (tests pass fakes of the native http and the Keystore storage); indexerEnv: the LAN scan and
 * the TorrServer settings for the Jackett / Prowlarr part.
 */
export function Sources({ ctx = phoneSourceContext, indexerEnv = phoneIndexerEnv }: { ctx?: () => SourceContext; indexerEnv?: () => IndexerEnv } = {}) {
  const [, setTick] = useState(0);
  const rerender = () => setTick((n) => n + 1);
  // sources with a login: saved credentials exist (asked once, no network)
  const [logged, setLogged] = useState<Record<string, boolean>>({});
  const [loginFor, setLoginFor] = useState<Source | null>(null);
  // «Ввести код»: the site's page is open in the browser sheet, or checked again after it
  const [unblocking, setUnblocking] = useState<Record<string, boolean>>({});
  const ts = torrServerSources();
  // one list of the built-in sites (the sites behind Cloudflare included); Jackett / Prowlarr have their own section
  const all = builtinSources().filter((s) => s.kind !== 'indexer');
  const torznabNote = torznabHiddenText(!ts.some((s) => s.id === 'ts-torznab'));

  // the phone listens to the TV's «Войти на телефоне» while this screen is open (and a while after)
  useEffect(() => holdSignInScreen(), []);

  useEffect(() => {
    let alive = true;
    const off = onHealthChange(() => alive && rerender());
    const offIdx = onIndexersChange(() => alive && rerender());
    const offFlare = onFlareStatus(() => alive && rerender());
    const offFlareUrl = onFlareChange(() => alive && rerender());
    if (flareSolverrUrl() && !flareStatus()) refreshFlareStatus(ctx().http).then(undefined, () => undefined);
    all
      .filter((s) => !!s.loggedIn)
      .forEach((s) => {
        s.loggedIn!(ctx()).then(
          (v) => alive && setLogged((m) => ({ ...m, [s.id]: v })),
          () => alive && setLogged((m) => ({ ...m, [s.id]: false })),
        );
      });
    return () => {
      alive = false;
      off();
      offIdx();
      offFlare();
      offFlareUrl();
    };
  }, []);

  const toggle = (s: Source) => {
    setSourceOn(s.id, !isSourceOn(s));
    rerender();
  };

  const loggedIn = (s: Source) => !!logged[s.id];

  const baseNote = (s: Source): HealthLine | null => {
    if (s.needsLogin && s.login && !loggedIn(s)) return { text: t('sources.state.login'), tone: 'muted' };
    const ban = ipBanNote(s.id);
    if (ban) return { text: ban, tone: 'bad' };
    const h = getHealth(s.id);
    // signed in, no search since: say only what is known (a password or a browser login alike: the site screen tells which)
    if (s.login && loggedIn(s) && !h) return { text: t('tvSources.loggedInDone'), tone: 'muted' };
    return healthText(h);
  };

  const noteOf = (s: Source): HealthLine | null => (s.cloudflare === true ? withCloudflareNote(baseNote(s)) : baseNote(s));

  // the site's own way past Cloudflare, under its row (the general hint stays at the bottom of the screen)
  const hintOf = (s: Source, note: HealthLine | null): CloudflareHint | null =>
    note && note.tone === 'bad' && isCloudflare(note.text) ? cloudflareHint(s, loggedIn(s)) : null;

  const logout = (s: Source) => {
    if (!s.logout) return;
    s.logout(ctx()).then(
      () => {
        setLogged((m) => ({ ...m, [s.id]: false }));
        // an optional login (NNM-Club) leaves no «нужен вход» behind
        if (s.needsLogin) setHealth(s.id, { state: 'login', at: Date.now() });
        else clearHealth(s.id);
      },
      (e) => showToast(errorMessage(e)),
    );
  };

  // the site's code page: the person enters the code in the browser sheet, then the site is checked once
  const codeOf = (s: Source): { busy: boolean; onPress: () => void } | undefined => {
    if (!s.unblock || !hasBrowserLogin() || (!ipBanNote(s.id) && !unblocking[s.id])) return undefined;
    return {
      busy: !!unblocking[s.id],
      onPress: () => {
        if (unblocking[s.id] || !s.unblock) return;
        setUnblocking((m) => ({ ...m, [s.id]: true }));
        const end = () => setUnblocking((m) => ({ ...m, [s.id]: false }));
        s.unblock(ctx()).then((opened) => {
          end();
          if (!opened) showToast(browserFailed());
        }, end);
      },
    };
  };

  const loggedInDone = (s: Source, viaBrowser?: boolean) => {
    setLoginFor(null);
    setLogged((m) => ({ ...m, [s.id]: true }));
    // signed in: the source takes part in the search; its real state comes with the next search
    setSourceOn(s.id, true);
    // a browser session got past the check in the page: the site's requests pass it too from now on
    if (viaBrowser && s.cloudflare === true) setCloudflareBypass(s.id, true);
    clearHealth(s.id);
  };

  return (
    <div class="m-screen" data-route="sources">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">{t('tvSettings.sources')}</h1>
      </div>
      <SendToTv
        ctx={ctx}
        indexers={indexerConnections()}
        loginNames={all.filter((s) => (s.id === 'rutracker' || LOGIN_SITES.indexOf(s.id) >= 0) && !!logged[s.id]).map((s) => ({ id: s.id, name: s.name }))}
      />
      <IndexerSection ctx={ctx} env={indexerEnv} onChange={rerender} />
      <FlareEntry />
      <section class="m-set-group">
        <div class="m-set-label">{t('tvSources.viaTorrServer')}</div>
        <div class="m-set-card m-src-card">
          {ts.map((s) => (
            <SourceRow key={s.id} source={s} note={healthText(getHealth(s.id))} onToggle={() => toggle(s)} />
          ))}
          {torznabNote && (
            <div class="m-src-row m-note m-muted" data-note="torznab-hidden">
              {torznabNote}
            </div>
          )}
        </div>
      </section>
      {all.length > 0 && (
        <section class="m-set-group" data-group="builtin">
          <div class="m-set-label">{t('sources.screen.builtin')}</div>
          <div class="m-set-card m-src-card">
            {all.map((s) => {
              const note = noteOf(s);
              return (
                <SourceRow
                  key={s.id}
                  source={s}
                  note={note}
                  hint={hintOf(s, note)}
                  login={s.login ? { loggedIn: loggedIn(s), onLogin: () => setLoginFor(s), onLogout: () => logout(s) } : undefined}
                  code={codeOf(s)}
                  onToggle={() => toggle(s)}
                  onOpen={s.login || s.cloudflare === true ? () => navigate({ name: 'sourceSite', id: s.id }) : undefined}
                />
              );
            })}
          </div>
        </section>
      )}
      <div class="m-hint-warn m-src-general" data-hint="general">
        <span>{t('sources.screen.generalHint')}</span>
        <button type="button" class="m-link-btn" data-faq="general" onClick={() => navigate({ name: 'faq' })}>
          {t('common.faq')}
        </button>
      </div>
      {loginFor && <TrackerLogin source={loginFor} ctx={ctx} onClose={() => setLoginFor(null)} onDone={(b) => loggedInDone(loginFor, b)} />}
    </div>
  );
}
