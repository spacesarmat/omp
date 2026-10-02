import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';
import { resetTo, afterConnectRoute } from '../nav';
import { scanPairQr } from '../platform/qr';
import { servers, addServer, setActiveServer, type SavedServer } from '../../../src/store/servers';
import { TorrServerClient, normalizeServerUrl } from '../../../src/api/torrserver';
import { errorMessage } from '../../../src/api/http';

type Status = { online: boolean; version: string } | 'pending';

const SCAN = 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10';

function Logo() {
  const xs = [23, 35, 47, 59, 71];
  return (
    <svg width="56" height="56" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="14" y="22" width="72" height="56" rx="10" fill="none" stroke="#F5B700" stroke-width="7" />
      {[29, 66].map((y) => xs.map((x) => <rect key={x + '-' + y} x={x} y={y} width="6" height="5" rx="1.5" fill="#F5B700" />))}
      <path d="M44 41 L59 50 L44 59 Z" fill="#E8EAF0" stroke="#E8EAF0" stroke-width="4" stroke-linejoin="round" />
    </svg>
  );
}

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
  const [cardError, setCardError] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    checkAll(servers.value);
  }, []);

  async function enter(cfg: { name?: string; url: string; user?: string; password?: string }): Promise<boolean> {
    setBusy(true);
    setError('');
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
  return (
    <form class="m-screen m-connect" onSubmit={submit}>
      <div class="m-brand">
        <Logo />
        <div>
          <div class="m-brand-name">OMP</div>
          <div class="m-muted">Open Movie Player</div>
        </div>
      </div>
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
    </form>
  );
}
