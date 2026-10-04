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
import type { Source, SourceContext } from '../../../src/sources/types';
import { allSources } from '../../../src/sources/registry';
import { rutrackerSavedLogin } from '../../../src/sources/rutracker';
import {
  buildTransferPayload,
  transferIndexers,
  transferWhen,
  validateTransferPayload,
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
import { sendSourcesToTv, sessionIp, SOURCES_REJECTED, tvState } from '../tv/tvClient';

const SENT_KEY = 'tsp.sourcesSent';
const TV_ICON = 'M3 5h18v11H3zM8 20h8';

export const SEND_TEXT =
  'Передать на телевизор включённые источники, подключения к Jackett/Prowlarr и вход на rutracker. Пароль и ключи уходят только на ваш ТВ по каналу пары и хранятся там в зашифрованном виде.';

/** What the phone says after a transfer, by the TV's rutracker answer. */
export function sentText(r: RutrackerResult | undefined): string {
  if (r === 'bad_login') return 'Источники переданы, но rutracker не принял логин или пароль';
  if (r === 'captcha') return 'Источники переданы, но rutracker просит капчу — войдите на сайте в браузере';
  if (r === 'error') return 'Источники переданы; вход на rutracker телевизор проверит при поиске';
  return 'Передано';
}

export const LOGIN_NOT_SENT = 'Вход на rutracker не передан: логин или пароль слишком длинный или с недопустимыми символами';
export const INDEXERS_NOT_SENT = 'Подключения к Jackett/Prowlarr не переданы — обновите OMP на телевизоре';
export const CLOUDFLARE_NOT_SENT = 'Настройки обхода Cloudflare и FlareSolverr не переданы — обновите OMP на телевизоре';

/** What the phone adds when the TV saved fewer connections than were sent ('' when all or none were sent). */
export function indexersText(sent: number, saved: number | undefined): string {
  if (!sent || saved === undefined || saved >= sent) return '';
  return 'Подключения к Jackett/Prowlarr сохранены не все: ' + saved + ' из ' + sent;
}
export const SOURCES_NOT_READY = 'Не удалось подготовить источники к передаче';

/**
 * The payload the TV accepts (same schema as its control server). A login the TV would refuse is left out so the
 * switches still go; loginDropped says so.
 */
export function transferPayload(
  list: Source[],
  login: TransferLogin | null,
  indexers?: TransferIndexer[],
  flare: string | null = flareSolverrUrl(),
): { payload: TransferPayload; loginDropped: boolean; indexersDropped: boolean } {
  const full = validateTransferPayload(buildTransferPayload(list, login, indexers, flare));
  if (full) return { payload: full, loginDropped: false, indexersDropped: false };
  const noLogin = validateTransferPayload(buildTransferPayload(list, null, indexers, flare));
  if (noLogin) return { payload: noLogin, loginDropped: !!login, indexersDropped: false };
  const bare = validateTransferPayload(buildTransferPayload(list, null, undefined, flare));
  if (!bare) throw new Error(SOURCES_NOT_READY);
  return { payload: bare, loginDropped: !!login, indexersDropped: !!(indexers && indexers.length) };
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
function SendToTv({ hasLogin, indexers, ctx }: { hasLogin: boolean; indexers: IndexerConn[]; ctx: () => SourceContext }) {
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
    const login = hasLogin && withLogin ? readLogin(ctx) : Promise.resolve(null);
    // the keys are read from the Keystore storage only now, and live only in this request
    const conns = indexerConnections();
    const list = conns.length ? transferIndexers(conns, ctx().secrets, withKeys) : Promise.resolve([] as TransferIndexer[]);
    let loginDropped = false;
    let indexersDropped = false;
    let cloudflareDropped = false;
    let sent = 0;
    Promise.all([login, list])
      .then(([l, idx]) => {
        const p = transferPayload(allSources(), l, idx);
        loginDropped = p.loginDropped;
        indexersDropped = p.indexersDropped;
        sent = p.payload.indexers ? p.payload.indexers.length : 0;
        const extras = !!(p.payload.indexers || p.payload.flaresolverr || p.payload.cloudflare);
        return sendSourcesToTv(p.payload).catch((e: unknown) => {
          // an older OMP on the TV refuses the v0.15 parts (connections, FlareSolverr, Cloudflare switches): send the rest
          if (!extras || !(e instanceof Error) || e.message !== SOURCES_REJECTED) throw e;
          if (sent) indexersDropped = true;
          if (p.payload.flaresolverr || p.payload.cloudflare) cloudflareDropped = true;
          sent = 0;
          return sendSourcesToTv(withoutNewParts(p.payload));
        });
      })
      .then(
        (r) => {
          saveJson(SENT_KEY, { ip, at: Date.now() });
          const partial = indexersText(sent, r.indexers);
          log(
            (r.rutracker && r.rutracker !== 'ok') || partial ? 'warn' : 'info',
            'tv',
            'Источники переданы на Android TV' + (r.rutracker ? ', вход на rutracker: ' + r.rutracker : '') + (sent ? ', индексаторов: ' + (r.indexers || 0) + ' из ' + sent : ''),
          );
          setBusy(false);
          setTick((n) => n + 1);
          const notes = [
            loginDropped ? LOGIN_NOT_SENT : '',
            indexersDropped ? INDEXERS_NOT_SENT : '',
            cloudflareDropped ? CLOUDFLARE_NOT_SENT : '',
            partial,
          ].filter((x) => x);
          const head = notes.length && !r.rutracker ? 'Источники переданы.' : sentText(r.rutracker);
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
            Вместе со входом на rutracker
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
  const [loginFor, setLoginFor] = useState<Source | null>(null);
  const ts = torrServerSources();
  // the Jackett / Prowlarr sources have their own section
  const builtins = builtinSources().filter((s) => s.kind !== 'indexer');
  const torznabNote = torznabHiddenText(!ts.some((s) => s.id === 'ts-torznab'));

  useEffect(() => {
    let alive = true;
    const off = onHealthChange(() => alive && rerender());
    const offIdx = onIndexersChange(() => alive && rerender());
    const offFlare = onFlareStatus(() => alive && rerender());
    const offFlareUrl = onFlareChange(() => alive && rerender());
    if (flareSolverrUrl() && !flareStatus()) refreshFlareStatus(ctx().http).then(undefined, () => undefined);
    builtins
      .filter((s) => s.needsLogin && s.loggedIn)
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

  const noteOf = (s: Source): HealthLine | null => {
    if (s.needsLogin && s.login && !loggedIn(s)) return { text: 'нужен вход', tone: 'muted' };
    const h = getHealth(s.id);
    // signed in, no search since: say only what is known
    if (s.needsLogin && s.login && !h) return { text: 'вход выполнен', tone: 'muted' };
    return healthText(h);
  };

  const logout = (s: Source) => {
    if (!s.logout) return;
    s.logout(ctx()).then(
      () => {
        setLogged((m) => ({ ...m, [s.id]: false }));
        setHealth(s.id, { state: 'login', at: Date.now() });
      },
      (e) => showToast(errorMessage(e)),
    );
  };

  const loggedInDone = (s: Source) => {
    setLoginFor(null);
    setLogged((m) => ({ ...m, [s.id]: true }));
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
      <SendToTv ctx={ctx} indexers={indexerConnections()} hasLogin={builtins.some((s) => s.id === 'rutracker' && !!logged[s.id])} />
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
      <div class="m-hint-warn">
        {JACKETT_HINT}
        <div>
          <button type="button" class="m-link" onClick={() => navigate({ name: 'faq' })}>
            Вопросы и ответы
          </button>
        </div>
      </div>
      {loginFor && <TrackerLogin source={loginFor} ctx={ctx} onClose={() => setLoginFor(null)} onDone={() => loggedInDone(loginFor)} />}
    </div>
  );
}
