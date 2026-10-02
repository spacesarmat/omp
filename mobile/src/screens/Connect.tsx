import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Icon } from '../ui/Icon';
import { Logo } from '../../../src/ui/Logo';
import { showToast } from '../ui/toast';
import { resetTo, navigate, afterConnectRoute } from '../nav';
import { activeTv } from '../tv/tvStore';
import { attachIfOmpForeground } from '../tv/playerLink';
import { scanPairQr } from '../platform/qr';
import { RenameSheet } from '../ui/RenameSheet';
import { servers, addServer, setActiveServer, updateServer, type SavedServer } from '../../../src/store/servers';
import { TorrServerClient, normalizeServerUrl } from '../../../src/api/torrserver';
import { errorMessage, isApiError } from '../../../src/api/http';
import { discover, candidateSubnets, subnetOf, DEFAULT_PORTS, type FoundServer } from '../../../src/api/discovery';
import { native } from '../platform/native';
import { localServer, refreshLocalServer } from '../server/localServer';

type ServerScanner = (isCancelled: () => boolean) => Promise<FoundServer[]>;
let scanner: ServerScanner | null = null;

/** Replaces the LAN scan for TorrServer (tests); null restores the real one. */
export function setServerScanner(fn: ServerScanner | null): void {
  scanner = fn;
}

export interface LanScanDeps {
  localIp: () => Promise<string | null>;
  discover: typeof discover;
}

/** Scans the phone's own /24 when its address is known, the common home subnets otherwise; stops once cancelled. */
export async function scanLan(
  isCancelled: () => boolean,
  d: LanScanDeps = { localIp: () => native.localIpv4(), discover },
): Promise<FoundServer[]> {
  const ip = await d.localIp().catch(() => null);
  const own = ip ? subnetOf(ip) : null;
  return d.discover({ subnets: own ? [own] : candidateSubnets(null, []), ports: DEFAULT_PORTS, isCancelled });
}

const TROUBLE =
  'Не находится? Проверьте, что оба устройства в одной сети Wi‑Fi, VPN выключен или разрешает локальную сеть, а в роутере выключена изоляция клиентов (гостевая сеть).';

const PHONE = 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2M10 7h4M10 10h4';
const INFO = 'M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18';

type Status = { online: boolean; version: string } | 'pending';

const SCAN = 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10';

const statuses = signal<Record<string, Status>>({});

function checkAll(list: SavedServer[]): void {
  const next: Record<string, Status> = {};
  for (const s of list) next[s.id] = 'pending';
  statuses.value = next;
  for (const s of list) {
    new TorrServerClient(s)
      .echo()
      .then(
        (version): Status => ({ online: true, version }),
        (): Status => ({ online: false, version: '' }),
      )
      .then((st) => {
        if (s.id in statuses.value) statuses.value = { ...statuses.value, [s.id]: st };
      });
  }
}

function statusText(st: Status | undefined): string {
  if (!st || st === 'pending') return 'проверка…';
  return st.online ? 'онлайн' + (st.version ? ' · ' + st.version : '') : 'недоступен';
}

export function Connect() {
  const [addr, setAddr] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [auth, setAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState<SavedServer | null>(null);
  const [cardError, setCardError] = useState<{ id: string; text: string } | null>(null);
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'done'>('idle');
  const [found, setFound] = useState<FoundServer[]>([]);
  const [netFail, setNetFail] = useState(false);

  useEffect(() => {
    checkAll(servers.value);
    void refreshLocalServer();
  }, []);

  // the phone can host TorrServer itself: look for one in the network first (only with no saved servers)
  const supported = localServer.value.supported;
  const noSaved = servers.value.length === 0;
  const auto = supported && noSaved;
  const [scanRun, setScanRun] = useState(0);
  useEffect(() => {
    // automatic on open (rules above), or by the «Найти в сети» button (scanRun > 0)
    if (!auto && scanRun === 0) return;
    let alive = true;
    setScanState('scanning');
    setFound([]);
    (scanner ?? scanLan)(() => !alive).then(
      (r) => {
        if (!alive) return;
        setFound(r);
        setScanState('done');
      },
      () => {
        if (!alive) return;
        setFound([]);
        setScanState('done');
      },
    );
    return () => {
      alive = false;
    };
  }, [auto, scanRun]);

  async function enter(cfg: { name?: string; url: string; user?: string; password?: string }): Promise<boolean> {
    setBusy(true);
    setError('');
    setNetFail(false);
    try {
      const url = normalizeServerUrl(cfg.url);
      const known = servers.value.find((x) => x.url === url);
      const creds = cfg.user !== undefined ? cfg : { user: known?.user, password: known?.password };
      await new TorrServerClient({ url, user: creds.user, password: creds.password }).echo();
      const s = addServer({ ...cfg, url });
      setActiveServer(s.id);
      resetTo(afterConnectRoute());
      return true;
    } catch (e) {
      setError(errorMessage(e));
      if (isApiError(e) && (e.kind === 'network' || e.kind === 'timeout')) setNetFail(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    if (!addr.trim()) {
      setError('Введите адрес сервера');
      return;
    }
    void enter({ url: addr, user: auth && user.trim() ? user.trim() : undefined, password: auth && pass ? pass : undefined });
  }

  async function scan() {
    if (busy) return;
    setError('');
    let data;
    try {
      data = await scanPairQr();
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    if (!data) return;
    const name = data.name || data.url.replace(/^https?:\/\//, '');
    if (await enter({ name, url: data.url, user: data.user, password: data.password })) {
      showToast('Сервер «' + name + '» добавлен');
      // the TV shows the QR in OMP: link to it so it returns to its catalog
      if (activeTv.value) void attachIfOmpForeground();
      else navigate({ name: 'tv' });
    }
  }

  async function open(s: SavedServer) {
    if (busy) return;
    setBusy(true);
    setError('');
    setCardError(null);
    try {
      await new TorrServerClient(s).echo();
      setActiveServer(s.id);
      resetTo(afterConnectRoute());
    } catch (e) {
      setCardError({ id: s.id, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const list = servers.value;
  const emptyScan = scanState === 'done' && found.length === 0;
  return (
    <form class="m-screen m-connect" onSubmit={submit}>
      <div class="m-brand">
        <Logo size={56} />
        <div>
          <div class="m-brand-name">OMP</div>
          <div class="m-muted">Open Movie Player</div>
        </div>
      </div>
      {auto && scanState === 'scanning' && (
        <div class="m-hint-info m-muted">Ищу TorrServer в сети…</div>
      )}
      {scanState === 'done' && found.length > 0 && (
        <>
          <h2 class="m-section">Найдено в сети</h2>
          <div class="m-list">
            {found.map((f) => {
              const saved = list.find((x) => x.url === normalizeServerUrl(f.url));
              return (
                <button
                  key={f.url}
                  type="button"
                  class="m-server"
                  disabled={busy}
                  onClick={() => (saved ? void open(saved) : void enter({ url: f.url }))}
                >
                  <span class="m-dot on" />
                  <span class="m-server-text">
                    <span class="m-server-name">{f.url.replace(/^https?:\/\//, '')}</span>
                    <span class="m-muted m-small">{saved ? 'сохранён · ' : ''}{f.version}</span>
                  </span>
                  <Icon d="M9 5l7 7-7 7" size={18} />
                </button>
              );
            })}
          </div>
        </>
      )}
      {auto && emptyScan && (
        <>
          <div class="m-hint-info m-muted">
            <Icon d={INFO} size={18} />
            В сети не нашлось TorrServer
          </div>
          <div class="m-local-card">
            <div class="m-local-head">
              <span class="m-local-icon">
                <Icon d={PHONE} size={24} />
              </span>
              <div class="m-local-title">TorrServer прямо на телефоне</div>
            </div>
            <div class="m-local-text">
              OMP запустит встроенный сервер. Телевизор найдёт его сам, пока телефон в той же сети Wi‑Fi.
            </div>
            <button type="button" class="m-btn m-btn-primary" onClick={() => navigate({ name: 'localServer' })}>
              Запустить TorrServer на телефоне
            </button>
          </div>
          <div class="m-muted m-small m-or">или</div>
        </>
      )}
      <button
        type="button"
        class="m-btn m-btn-secondary"
        disabled={scanState === 'scanning'}
        onClick={() => setScanRun(scanRun + 1)}
      >
        {scanState === 'scanning' ? 'Ищу…' : 'Найти в сети'}
      </button>
      {(emptyScan || netFail) && scanState !== 'scanning' && (
        <div class="m-hint-info m-muted m-trouble">{TROUBLE}</div>
      )}
      <h1 class="m-title">Подключение к TorrServer</h1>
      <div class="m-field">
        <label for="addr">Адрес сервера</label>
        <input
          id="addr"
          class="m-input"
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="192.168.1.10:8090"
          value={addr}
          onInput={(e) => setAddr((e.target as HTMLInputElement).value)}
        />
        {error && (
          <div class="m-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <button type="button" class="m-link" aria-expanded={auth} onClick={() => setAuth(!auth)}>
        <Icon d={auth ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} size={18} />
        Логин и пароль
      </button>
      {auth && (
        <div class="m-field-group">
          <div class="m-field">
            <label for="user">Логин</label>
            <input
              id="user"
              class="m-input"
              type="text"
              autoCapitalize="off"
              autoComplete="username"
              value={user}
              onInput={(e) => setUser((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="m-field">
            <label for="pass">Пароль</label>
            <input
              id="pass"
              class="m-input"
              type="password"
              autoComplete="current-password"
              value={pass}
              onInput={(e) => setPass((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
      )}
      <button type="submit" class="m-btn m-btn-primary" disabled={busy}>
        {busy ? 'Подключаюсь…' : 'Подключиться'}
      </button>
      <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={() => void scan()}>
        <Icon d={SCAN} size={20} />
        Сканировать QR с телевизора
      </button>
      <p class="m-muted m-note">
        На телевизоре: OMP → Настройки → «Подключить телефон». Сервер, логин и пароль перенесутся автоматически.
      </p>
      {list.length > 0 && (
        <>
          <h2 class="m-section">Сохранённые серверы</h2>
          <div class="m-list">
            {list.map((s) => {
              const st = statuses.value[s.id];
              const on = !!st && st !== 'pending' && st.online;
              return (
                <div key={s.id} class="m-server-wrap">
                <div class="m-server-row">
                <button type="button" class="m-server" onClick={() => void open(s)}>
                  <span class={'m-dot' + (on ? ' on' : '')} />
                  <span class="m-server-text">
                    <span class="m-server-name">{s.name}</span>
                    <span class="m-muted m-small">
                      {s.url.replace(/^https?:\/\//, '')} · {statusText(st)}
                    </span>
                  </span>
                  <Icon d="M9 5l7 7-7 7" size={18} />
                </button>
                <button type="button" class="m-icon-btn" aria-label={'Переименовать ' + s.name} onClick={() => setRenaming(s)}>
                  <Icon d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" size={20} />
                </button>
                </div>
                {cardError?.id === s.id && (
                  <div class="m-error" role="alert">
                    {cardError.text}
                  </div>
                )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {renaming && (
        <RenameSheet
          title="Название сервера"
          value={renaming.name}
          onSave={(n) => {
            updateServer(renaming.id, { name: n || renaming.url.replace(/^https?:\/\//, '') });
            setRenaming(null);
          }}
          onCancel={() => setRenaming(null)}
        />
      )}
    </form>
  );
}
