import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { goBack } from '../nav';
import { native, type FoundTv, type FoundOmpTv } from '../platform/native';
import { connectTv, cancelWarmUp, disconnectTv, pairAtv, sessionIp, tvState, tvError, TV_FORGOT } from '../tv/tvClient';
import { RenameSheet } from '../ui/RenameSheet';
import { CodeSheet } from '../ui/CodeSheet';
import { tvs, activeTv, forgetTv, renameTv, ATV_PORT, type SavedTv, type TvKind } from '../tv/tvStore';

type Discoverer = (timeoutMs: number) => Promise<FoundTv[]>;
type AtvDiscoverer = (timeoutMs: number) => Promise<FoundOmpTv[]>;
let discoverer: Discoverer | null = null;
let atvDiscoverer: AtvDiscoverer | null = null;

/** Replaces LG (SSDP) discovery (tests); null restores the native one. */
export function setTvDiscoverer(fn: Discoverer | null): void {
  discoverer = fn;
}

/** Replaces Android TV (NSD) discovery (tests); null restores the native one. */
export function setAtvDiscoverer(fn: AtvDiscoverer | null): void {
  atvDiscoverer = fn;
}

const SEARCH_MS = 4000;
const KIND_LABEL: Record<TvKind, string> = { lg: 'LG webOS', atv: 'Android TV' };

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

interface Row {
  ip: string;
  name: string;
  meta: string;
  kind: TvKind;
  saved?: SavedTv;
  /** Android TV as NSD found it. */
  atv?: FoundOmpTv;
}

const PENCIL = 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4';

export function Tv() {
  const [found, setFound] = useState<FoundTv[]>([]);
  const [searching, setSearching] = useState(true);
  const [target, setTarget] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [ip, setIp] = useState('');
  const [formError, setFormError] = useState('');
  const [renaming, setRenaming] = useState<SavedTv | null>(null);
  const [foundAtv, setFoundAtv] = useState<FoundOmpTv[]>([]);
  /** Android TV waiting for its pairing code. */
  const [coding, setCoding] = useState<FoundOmpTv | null>(null);

  useEffect(() => {
    let alive = true;
    // SSDP (LG) and NSD (Android TV with OMP) in parallel; each list shows as soon as it arrives
    const lg = (discoverer ?? ((ms: number) => native.discoverTvs(ms)))(SEARCH_MS)
      .then((r) => alive && setFound(r))
      .catch(() => {});
    const atv = (atvDiscoverer ?? ((ms: number) => native.discoverOmpTvs(ms)))(SEARCH_MS)
      .then((r) => alive && setFoundAtv(r))
      .catch(() => {});
    Promise.all([lg, atv]).then(() => alive && setSearching(false));
    return () => {
      alive = false;
    };
  }, []);

  const savedList = tvs.value;
  const ompMeta = (ip: string, version?: string) => ip + (version ? ' · OMP ' + version : '');
  const rows: Row[] = savedList.map((t) => {
    const kind: TvKind = t.kind === 'atv' ? 'atv' : 'lg';
    const atv = kind === 'atv' ? foundAtv.find((f) => f.ip === t.ip) : undefined;
    const meta = atv && atv.version ? ompMeta(t.ip, atv.version) : t.ip + ' · сохранён';
    return { ip: t.ip, name: t.name, meta, kind, saved: t, atv };
  });
  for (const f of foundAtv) {
    if (rows.some((r) => r.ip === f.ip)) continue;
    rows.push({ ip: f.ip, name: f.name, meta: ompMeta(f.ip, f.version), kind: 'atv', atv: f });
  }
  for (const f of found) {
    if (rows.some((r) => r.ip === f.ip)) continue;
    rows.push({ ip: f.ip, name: f.name, meta: f.ip + (f.model ? ' · ' + f.model : ''), kind: 'lg' });
  }

  const state = tvState.value;
  if (target && !rows.some((r) => r.ip === target) && (state === 'connecting' || state === 'pairing' || state === 'error')) {
    rows.push({ ip: target, name: 'Телевизор ' + target, meta: target, kind: 'lg' });
  }

  async function forget(ip: string) {
    if (sessionIp.value === ip) await disconnectTv();
    forgetTv(ip);
  }

  /** LG: SSAP connect. Android TV: a paired one connects, a new (or forgetful) one asks for the code. */
  function openRow(r: Row) {
    if (r.kind !== 'atv') {
      connect(r);
      return;
    }
    const forgot = target === r.ip && state === 'error' && tvError.value === TV_FORGOT;
    if (r.saved?.token && !forgot) {
      setTarget(r.ip);
      setFormError('');
      if (activeTv.value?.ip !== r.ip) cancelWarmUp();
      connectTv(r.saved).catch(() => {});
      return;
    }
    setCoding({
      ip: r.ip,
      port: r.atv?.port ?? r.saved?.ctlPort ?? ATV_PORT,
      name: r.atv?.name ?? r.saved?.defaultName ?? r.name,
      version: r.atv?.version ?? '',
    });
  }

  async function pair(found: FoundOmpTv, code: string) {
    if (activeTv.value?.ip !== found.ip) cancelWarmUp();
    setTarget(found.ip);
    await pairAtv(found, code);
    setCoding(null);
  }

  function connect(r: { ip: string; name: string }) {
    setTarget(r.ip);
    setFormError('');
    const saved = savedList.find((t) => t.ip === r.ip);
    if (activeTv.value?.ip !== r.ip) cancelWarmUp();
    connectTv({ ...saved, ip: r.ip, name: saved?.name ?? r.name, clientKey: saved?.clientKey, port: saved?.port }).catch(() => {});
  }

  function connectManual(e: Event) {
    e.preventDefault();
    const v = ip.trim();
    if (!IPV4.test(v)) {
      setFormError('Введите IP-адрес вида 192.168.1.42');
      return;
    }
    connect({ ip: v, name: 'LG ' + v });
  }

  return (
    <div class="m-screen m-tvscreen">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">Телевизор</h1>
      </div>
      <p class="m-muted m-note">
        Телефон и телевизор должны быть в одной сети Wi-Fi. На телевизоре должен быть установлен OMP.
      </p>
      {searching && (
        <div class="m-muted m-searching">
          <svg class="m-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F5B700" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
          Ищу телевизоры…
        </div>
      )}
      <div class="m-list">
        {rows.map((r) => {
          const mine = target === r.ip;
          const connecting = mine && state === 'connecting';
          const pairing = mine && state === 'pairing';
          const connected = state === 'connected' && sessionIp.value === r.ip;
          const failed = mine && state === 'error';
          const cls = 'm-tv' + (pairing || connecting ? ' pairing' : '') + (connected ? ' connected' : '');
          return (
            <div key={r.ip} class={cls}>
              <div class="m-tv-row">
                <button type="button" class="m-tv-main" onClick={() => openRow(r)}>
                  <span class="m-tv-icon">
                    <Icon d="M3 5h18v11H3zM8 20h8" size={26} />
                  </span>
                  <span class="m-tv-text">
                    <span class="m-server-name">{r.name}</span>
                    <span class="m-muted m-small">
                      {r.meta}
                      {connecting || pairing ? ' · подключение…' : ''}
                    </span>
                    <span class={'m-tv-kind ' + r.kind}>{KIND_LABEL[r.kind]}</span>
                    {connected && (
                      <span class="m-tv-ok">
                        <Icon d="M5 12l5 5 9-10" size={16} />
                        Подключён
                      </span>
                    )}
                  </span>
                </button>
                {r.saved && (
                  <button type="button" class="m-icon-btn" aria-label={'Переименовать ' + r.name} onClick={() => setRenaming(r.saved!)}>
                    <Icon d={PENCIL} size={20} />
                  </button>
                )}
                {r.saved && (
                  <button type="button" class="m-icon-btn" aria-label={'Забыть ' + r.name} onClick={() => void forget(r.ip)}>
                    <Icon d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" size={20} />
                  </button>
                )}
              </div>
              {pairing && <div class="m-hint-warn">Подтвердите подключение на экране телевизора пультом: «Разрешить».</div>}
              {failed && (
                <div class="m-error" role="alert">
                  {tvError.value}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {manual ? (
        <form class="m-field" onSubmit={connectManual}>
          <label for="tv-ip">IP-адрес телевизора</label>
          <input
            id="tv-ip"
            class="m-input"
            type="text"
            inputMode="decimal"
            placeholder="192.168.1.42"
            value={ip}
            onInput={(e) => setIp((e.target as HTMLInputElement).value)}
          />
          {formError && (
            <div class="m-error" role="alert">
              {formError}
            </div>
          )}
          <button type="submit" class="m-btn m-btn-primary">
            Подключить
          </button>
        </form>
      ) : (
        <button type="button" class="m-btn m-btn-secondary" onClick={() => setManual(true)}>
          Ввести IP-адрес телевизора
        </button>
      )}
      <p class="m-muted m-note m-tv-tip">
        Телефон запомнит телевизор: в следующий раз «Смотреть на ТВ» и пульт заработают сразу. Чтобы включать телевизор с
        телефона, на ТВ включите: Общие → Устройства → «Включение мобильного ТВ» (или «Включение через Wi‑Fi»).
      </p>
      {coding && (
        <CodeSheet tvName={coding.name} onSubmit={(code) => pair(coding, code)} onCancel={() => setCoding(null)} />
      )}
      {renaming && (
        <RenameSheet
          title="Название телевизора"
          value={renaming.name}
          onSave={(n) => {
            renameTv(renaming.ip, n);
            setRenaming(null);
          }}
          onCancel={() => setRenaming(null)}
        />
      )}
    </div>
  );
}
