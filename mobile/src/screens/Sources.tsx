import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { TrackerLogin } from '../ui/TrackerLogin';
import { showToast } from '../ui/toast';
import { goBack, navigate } from '../nav';
import { phoneSourceContext } from '../searchContext';
import { errorMessage } from '../../../src/api/http';
import { builtinSources, torrServerSources } from '../../../src/sources/registry';
import { clearHealth, getHealth, isSourceOn, onHealthChange, setHealth, setSourceOn } from '../../../src/sources/store';
import { healthText, isCloudflare, JACKETT_HINT, type HealthLine } from '../../../src/sources/view';
import { BROWSER_DONE } from '../../../src/sources/browserLogin';
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
import { activeTv, isAtv } from '../tv/tvStore';
import { holdSignInScreen } from '../cloudflare';
import { sendSourcesToTv, sessionIp, SOURCES_REJECTED, tvState, type SourcesSent } from '../tv/tvClient';

const SENT_KEY = 'tsp.sourcesSent';
const TV_ICON = 'M3 5h18v11H3zM8 20h8';

export const SEND_TEXT =
  'Передать на телевизор включённые источники, подключения к Jackett/Prowlarr и входы на сайты. Пароли и ключи уходят только на ваш ТВ по каналу пары и хранятся там в зашифрованном виде.';

/** What the phone says after a transfer, by the TV's rutracker answer. */
export function sentText(r: RutrackerResult | undefined): string {
  if (r === 'bad_login') return 'Источники переданы, но rutracker не принял логин или пароль';
  if (r === 'captcha') return 'Источники переданы, но rutracker просит капчу — нажмите «Войти через браузер»';
  if (r === 'error') return 'Источники переданы; вход на rutracker телевизор проверит при поиске';
  return 'Передано';
}

/** The logins left out of a transfer: by site (too long, bad characters), or all of them when the body was too big. */
export function loginsNotSent(names: string[], tooBig: boolean): string {
  if (tooBig) return 'Входы на сайты не переданы: слишком много данных для телевизора';
  return 'Вход на ' + names.join(', ') + ' не передан: логин или пароль слишком длинный или с недопустимыми символами';
}

export const LOGIN_NOT_SENT = loginsNotSent(['rutracker'], false);
export const RUTRACKER_NOT_STORED = 'Телевизор не смог сохранить вход на rutracker: защищённое хранилище недоступно';

/** What the phone adds about each site's login the TV checked ('' when all were accepted). */
export function siteLoginsText(logins: { [site: string]: RutrackerResult } | undefined, nameOf: (id: string) => string): string {
  if (!logins) return '';
  return Object.keys(logins)
    .map((id) => {
      const n = nameOf(id);
      const r = logins[id];
      if (r === 'bad_login') return n + ' не принял логин или пароль';
      if (r === 'captcha') return n + ' просит капчу — нажмите «Войти через браузер»';
      if (r === 'error') return 'вход на ' + n + ' телевизор проверит при поиске';
      return '';
    })
    .filter((x) => x)
    .join('. ');
}

/** The checkbox of the logins that go with the transfer: «Вместе со входом на rutracker, Kinozal». */
export function withLoginsLabel(names: string[]): string {
  return 'Вместе со входом на ' + names.join(', ');
}
export const INDEXERS_NOT_SENT = 'Подключения к Jackett/Prowlarr не переданы — обновите OMP на телевизоре';
export const CLOUDFLARE_NOT_SENT = 'Настройки обхода Cloudflare и FlareSolverr не переданы — обновите OMP на телевизоре';

/** What the phone adds when the TV saved fewer connections than were sent ('' when all or none were sent). */
export function indexersText(sent: number, saved: number | undefined): string {
  if (!sent || saved === undefined || saved >= sent) return '';
  return 'Подключения к Jackett/Prowlarr сохранены не все: ' + saved + ' из ' + sent;
}
export const SOURCES_NOT_READY = 'Не удалось подготовить источники к передаче';

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
  const full = validateTransferPayload(buildTransferPayload(list, rut, indexers, flare, sites));
  if (full) return { payload: full, loginDropped: dropped.length > 0, droppedLogins: dropped, tooBig: false, indexersDropped: false };
  const noLogin = validateTransferPayload(buildTransferPayload(list, null, indexers, flare));
  if (noLogin) return { payload: noLogin, loginDropped: all.length > 0, droppedLogins: all, tooBig: all.length > dropped.length, indexersDropped: false };
  const bare = validateTransferPayload(buildTransferPayload(list, null, undefined, flare));
  if (!bare) throw new Error(SOURCES_NOT_READY);
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
  return sendSourcesToTv(p.payload, withSessions ? sessions : undefined)
    .catch((e: unknown) => {
      // an older OMP on the TV refuses the v0.15 parts (connections, FlareSolverr, Cloudflare switches, site logins)
      if (!extras || !(e instanceof Error) || e.message !== SOURCES_REJECTED) throw e;
      if (state.sent) state.indexersDropped = true;
      if (p.payload.flaresolverr || p.payload.cloudflare) state.cloudflareDropped = true;
      if (p.payload.logins) state.sitesDropped = true;
      if (withSessions) state.sessionsDropped = true;
      state.sent = 0;
      return sendSourcesToTv(withoutNewParts(p.payload));
    })
    .then((r) => ({ r, ...state }));
}

export const SITES_NOT_SENT = 'Входы на сайты за Cloudflare не переданы — обновите OMP на телевизоре';
export const SESSIONS_NOT_SENT = 'Входы через браузер не переданы — обновите OMP на телевизоре';

/** What the phone adds about each browser session the TV checked ('' when all were kept). */
export function sessionsText(sessions: { [site: string]: string } | undefined, nameOf: (id: string) => string): string {
  if (!sessions) return '';
  return Object.keys(sessions)
    .map((id) => {
      const r = sessions[id];
      if (r === 'error') return 'телевизор не подтвердил вход на ' + nameOf(id) + ' — войдите на телевизоре через браузер';
      if (r === 'missing') return 'вход на ' + nameOf(id) + ' не найден — войдите заново';
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
            'Источники переданы на Android TV' +
              (r.rutracker ? ', вход на rutracker: ' + r.rutracker : '') +
              Object.keys(r.logins || {}).map((id) => ', вход на ' + id + ': ' + r.logins![id]).join('') +
              (sent ? ', индексаторов: ' + (r.indexers || 0) + ' из ' + sent : ''),
          );
          setBusy(false);
          setTick((n) => n + 1);
          const notes = [
            droppedNote,
            r.rutrackerNotStored ? RUTRACKER_NOT_STORED : '',
            indexersDropped ? INDEXERS_NOT_SENT : '',
            cloudflareDropped ? CLOUDFLARE_NOT_SENT : '',
            sitesDropped ? SITES_NOT_SENT : '',
            sessionsDropped ? SESSIONS_NOT_SENT : '',
            partial,
            siteNotes,
          ].filter((x) => x);
          const head = notes.length && (!r.rutracker || r.rutrackerNotStored) ? 'Источники переданы.' : sentText(r.rutracker);
          showToast(notes.length ? head + ' ' + notes.join('. ') : head, notes.length ? 6000 : undefined);
        },
        (e) => {
          const msg = errorMessage(e);
          log('warn', 'tv', 'Передача источников на Android TV: ' + msg);
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
          <span class="m-send-name">{'Android TV «' + tv.name + '»'}</span>
          <span class={'m-send-state' + (connected && paired ? ' ok' : '')}>{connected && paired ? 'подключён' : 'не подключён'}</span>
        </div>
        <div class="m-note m-muted">{SEND_TEXT}</div>
        {hasLogin && (
          <label class="m-send-check">
            <input type="checkbox" checked={withLogin} onChange={(e) => setWithLogin((e.target as HTMLInputElement).checked)} />
            {withLoginsLabel(loginNames.map((x) => x.name))}
          </label>
        )}
        {hasKeys && (
          <label class="m-send-check">
            <input type="checkbox" checked={withKeys} onChange={(e) => setWithKeys((e.target as HTMLInputElement).checked)} />
            Вместе с ключами Jackett/Prowlarr
          </label>
        )}
        {paired ? (
          <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={send}>
            {busy ? 'Передаю…' : 'Передать на телевизор'}
          </button>
        ) : (
          <button type="button" class="m-btn m-btn-secondary" onClick={() => navigate({ name: 'tv' })}>
            Подключить заново
          </button>
        )}
        {error && (
          <div class="m-error" role="alert">
            {error}
          </div>
        )}
        {when && !error && <div class="m-send-done">{'Передано ' + when.day + ' в ' + when.time}</div>}
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
      <div class="m-set-label">Обход Cloudflare</div>
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
const TS_LABELS: Record<string, string> = {
  'ts-rutor': 'rutor (поиск TorrServer)',
  'ts-torznab': 'Jackett / Prowlarr (Torznab)',
};

function label(s: Source): string {
  return TS_LABELS[s.id] || s.name;
}

function SourceRow({
  source,
  note,
  login,
  onToggle,
  onOpen,
}: {
  source: Source;
  note: HealthLine | null;
  login?: { loggedIn: boolean; onLogin: () => void; onLogout: () => void };
  onToggle: () => void;
  /** A site behind Cloudflare: its own screen (Cloudflare switch, warning). */
  onOpen?: () => void;
}) {
  const on = isSourceOn(source);
  const name = label(source);
  return (
    <>
      <div class="m-src-row" data-source={source.id}>
        <span class="m-src-name">
          <span>{name}</span>
          {note && <span class={'m-src-note' + (note.tone === 'muted' ? '' : ' ' + note.tone)}>{note.text}</span>}
        </span>
        {login &&
          (login.loggedIn ? (
            <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={login.onLogout}>
              Выйти
            </button>
          ) : (
            <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={login.onLogin}>
              Войти
            </button>
          ))}
        {onOpen && (
          <button type="button" class="m-icon-btn" aria-label={'Настройки: ' + name} data-open={source.id} onClick={onOpen}>
            <Icon d="M9 5l7 7-7 7" size={18} />
          </button>
        )}
        <button type="button" role="switch" aria-checked={on} aria-label={name} class={'m-switch' + (on ? ' on' : '')} onClick={onToggle}>
          <span class="m-switch-knob" />
        </button>
      </div>
      {note && isCloudflare(note.text) && (
        <div class="m-src-hint" data-hint="jackett">
          {JACKETT_HINT}
        </div>
      )}
    </>
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
  // sources whose login is a browser session («вход выполнен в браузере»)
  const [browser, setBrowser] = useState<Record<string, boolean>>({});
  const [loginFor, setLoginFor] = useState<Source | null>(null);
  const ts = torrServerSources();
  // the Jackett / Prowlarr sources have their own section; the sites behind Cloudflare too
  const all = builtinSources().filter((s) => s.kind !== 'indexer');
  const builtins = all.filter((s) => s.cloudflare !== true);
  const cfSites = all.filter((s) => s.cloudflare === true);
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
      .filter((s) => s.needsLogin && s.loggedIn)
      .forEach((s) => {
        s.loggedIn!(ctx()).then(
          (v) => alive && setLogged((m) => ({ ...m, [s.id]: v })),
          () => alive && setLogged((m) => ({ ...m, [s.id]: false })),
        );
        if (s.browserSession) {
          s.browserSession(ctx()).then(
            (v) => alive && setBrowser((m) => ({ ...m, [s.id]: v })),
            () => undefined,
          );
        }
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

  const noteOf = (s: Source): HealthLine | null => {
    if (s.needsLogin && s.login && !loggedIn(s)) return { text: 'нужен вход', tone: 'muted' };
    const h = getHealth(s.id);
    // signed in, no search since: say only what is known
    if (s.needsLogin && s.login && !h) return { text: browser[s.id] ? BROWSER_DONE : 'вход выполнен', tone: 'muted' };
    return healthText(h);
  };

  const logout = (s: Source) => {
    if (!s.logout) return;
    s.logout(ctx()).then(
      () => {
        setLogged((m) => ({ ...m, [s.id]: false }));
        setBrowser((m) => ({ ...m, [s.id]: false }));
        setHealth(s.id, { state: 'login', at: Date.now() });
      },
      (e) => showToast(errorMessage(e)),
    );
  };

  const loggedInDone = (s: Source, viaBrowser?: boolean) => {
    setLoginFor(null);
    setLogged((m) => ({ ...m, [s.id]: true }));
    setBrowser((m) => ({ ...m, [s.id]: !!viaBrowser }));
    // signed in: the source takes part in the search; its real state comes with the next search
    setSourceOn(s.id, true);
    clearHealth(s.id);
  };

  return (
    <div class="m-screen" data-route="sources">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">Источники поиска</h1>
      </div>
      <SendToTv
        ctx={ctx}
        indexers={indexerConnections()}
        loginNames={all.filter((s) => (s.id === 'rutracker' || LOGIN_SITES.indexOf(s.id) >= 0) && !!logged[s.id]).map((s) => ({ id: s.id, name: s.name }))}
      />
      <IndexerSection ctx={ctx} env={indexerEnv} onChange={rerender} />
      <FlareEntry />
      <section class="m-set-group">
        <div class="m-set-label">Через TorrServer</div>
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
      {builtins.length > 0 && (
        <section class="m-set-group">
          <div class="m-set-label">Встроенные · на телефоне</div>
          <div class="m-set-card m-src-card">
            {builtins.map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                note={noteOf(s)}
                login={
                  s.needsLogin && s.login
                    ? {
                        loggedIn: loggedIn(s),
                        onLogin: () => setLoginFor(s),
                        onLogout: () => logout(s),
                      }
                    : undefined
                }
                onToggle={() => toggle(s)}
                onOpen={s.cloudflare === true ? () => navigate({ name: 'sourceSite', id: s.id }) : undefined}
              />
            ))}
          </div>
        </section>
      )}
      {cfSites.length > 0 && (
        <section class="m-set-group" data-group="cloudflare">
          <div class="m-set-label">Сайты за Cloudflare</div>
          <div class="m-set-card m-src-card">
            {cfSites.map((s) => (
              <SourceRow key={s.id} source={s} note={noteOf(s)} onToggle={() => toggle(s)} onOpen={() => navigate({ name: 'sourceSite', id: s.id })} />
            ))}
          </div>
        </section>
      )}
      <div class="m-hint-warn">
        {JACKETT_HINT}
        <div>
          <button type="button" class="m-link" onClick={() => navigate({ name: 'faq' })}>
            Вопросы и ответы
          </button>
        </div>
      </div>
      {loginFor && <TrackerLogin source={loginFor} ctx={ctx} onClose={() => setLoginFor(null)} onDone={(b) => loggedInDone(loginFor, b)} />}
    </div>
  );
}
