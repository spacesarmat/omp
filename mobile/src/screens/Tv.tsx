import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { goBack } from '../nav';
import { native, type FoundTv } from '../platform/native';
import { connectTv, disconnectTv, sessionIp, tvState, tvError } from '../tv/tvClient';
import { tvs, forgetTv, type SavedTv } from '../tv/tvStore';

type Discoverer = (timeoutMs: number) => Promise<FoundTv[]>;
let discoverer: Discoverer | null = null;

/** Replaces TV discovery (tests); null restores the native one. */
export function setTvDiscoverer(fn: Discoverer | null): void {
  discoverer = fn;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

interface Row {
  ip: string;
  name: string;
  meta: string;
  saved?: SavedTv;
}

export function Tv() {
  const [found, setFound] = useState<FoundTv[]>([]);
  const [searching, setSearching] = useState(true);
  const [target, setTarget] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [ip, setIp] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let alive = true;
    (discoverer ?? ((ms: number) => native.discoverTvs(ms)))(4000)
      .then((r) => alive && setFound(r))
      .catch(() => {})
      .finally(() => alive && setSearching(false));
    return () => {
      alive = false;
    };
  }, []);

  const savedList = tvs.value;
  const rows: Row[] = savedList.map((t) => ({ ip: t.ip, name: t.name, meta: t.ip + ' · сохранён', saved: t }));
  for (const f of found) {
    if (rows.some((r) => r.ip === f.ip)) continue;
    rows.push({ ip: f.ip, name: f.name, meta: f.ip + (f.model ? ' · ' + f.model : '') });
  }

  const state = tvState.value;
  if (target && !rows.some((r) => r.ip === target) && (state === 'connecting' || state === 'pairing' || state === 'error')) {
    rows.push({ ip: target, name: 'Телевизор ' + target, meta: target });
  }

  async function forget(ip: string) {
    if (sessionIp.value === ip) await disconnectTv();
    forgetTv(ip);
  }

  function connect(r: { ip: string; name: string }) {
    setTarget(r.ip);
    setFormError('');
    const saved = savedList.find((t) => t.ip === r.ip);
    connectTv({ ip: r.ip, name: saved?.name ?? r.name, clientKey: saved?.clientKey }).catch(() => {});
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
          Ищу телевизоры LG…
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
                <button type="button" class="m-tv-main" onClick={() => connect(r)}>
                  <span class="m-tv-icon">
                    <Icon d="M3 5h18v11H3zM8 20h8" size={26} />
                  </span>
                  <span class="m-tv-text">
                    <span class="m-server-name">{r.name}</span>
                    <span class="m-muted m-small">
                      {r.meta}
                      {connecting || pairing ? ' · подключение…' : ''}
                    </span>
                  </span>
                  {connected && (
                    <span class="m-tv-ok">
                      <Icon d="M5 12l5 5 9-10" size={18} />
                      Подключён
                    </span>
                  )}
                </button>
                {r.saved && (
                  <button type="button" class="m-btn-text" aria-label={'Забыть ' + r.name} onClick={() => void forget(r.ip)}>
                    Забыть
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
        Телефон запомнит телевизор: в следующий раз «Смотреть на ТВ» и пульт заработают сразу.
      </p>
    </div>
  );
}
