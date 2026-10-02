import { useEffect, useState } from 'preact/hooks';
import { navigate } from '../nav';
import { Icon } from '../ui/Icon';
import {
  localServer,
  localAutostart,
  setAutostart,
  startLocal,
  stopLocal,
  refreshLocalServer,
  localCacheBytes,
  clearLocalCache,
  formatBytes,
  LOCAL_PORT,
  LOCAL_NAME,
  LOCAL_URL,
} from '../server/localServer';
import { TORRSERVER_VERSION } from '../server/torrserverVersion';
import { showToast } from '../ui/toast';
import { activeServer, addServer, servers } from '../../../src/store/servers';
import { activeTv } from '../tv/tvStore';
import { tvState } from '../tv/tvClient';
import { tvOmpVersions, tvNeedsUpdate, tvOpensUpdate, openUpdateOnTv, type TvOmp } from '../tv/tvUpdate';
import { errorMessage } from '../../../src/api/http';
import { settings, updateSettings } from '../../../src/store/settings';
import { checkForUpdate, type CheckResult } from '../../../src/store/updates';
import { ANDROID_UPDATE_URL } from '../../../src/lib/updateInfo';
import { APP_VERSION } from '../../../src/version';

type Checker = (o: { manual: boolean; url?: string }) => Promise<CheckResult>;
let checker: Checker | null = null;

/** Replaces the update check (tests); null restores the real one. */
export function setUpdateChecker(fn: Checker | null): void {
  checker = fn;
}

export function runUpdateCheck(o: { manual: boolean; url?: string }): Promise<CheckResult> {
  return (checker ?? checkForUpdate)(o);
}

const PROJECT_URL = 'https://github.com/spacesarmat/omp';
const TORRSERVER_SOURCE_URL = 'https://github.com/YouROK/TorrServer/tree/' + TORRSERVER_VERSION;

function Switch(p: { on: boolean; label: string; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={p.on}
      aria-label={p.label}
      class={'m-switch' + (p.on ? ' on' : '')}
      disabled={p.disabled}
      onClick={p.onToggle}
    >
      <span class="m-switch-knob" />
    </button>
  );
}

function LocalServerSection() {
  const st = localServer.value;
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void refreshLocalServer();
  }, []);
  useEffect(() => {
    let alive = true;
    void localCacheBytes().then((b) => alive && setBytes(b));
    return () => {
      alive = false;
    };
  }, [st.running]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (st.running) await stopLocal();
      else {
        setStarting(true);
        await startLocal();
        // started here, not through the setup screen: make it a saved server too (not the active one)
        if (localServer.value.running && !servers.value.some((s) => s.url === LOCAL_URL)) {
          addServer({ name: LOCAL_NAME, url: LOCAL_URL });
        }
      }
    } finally {
      setStarting(false);
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    try {
      await clearLocalCache();
      setBytes(await localCacheBytes());
    } catch {
      showToast('Не удалось очистить кэш');
    } finally {
      setBusy(false);
    }
  }

  const meta = [st.version, st.ip ? st.ip + ':' + LOCAL_PORT : ''].filter(Boolean).join(' · ');
  return (
    <section class="m-set-group" data-section="local-server">
      <div class="m-set-label">TorrServer на телефоне</div>
      <div class="m-set-card">
        <div class="m-set-row">
          <span class={'m-status-dot' + (st.running ? ' on' : '')} />
          <div class="m-set-text" style="flex-grow: 1">
            <span style="font-weight: 700">{starting ? 'Запускаю…' : st.running ? 'Работает' : 'Остановлен'}</span>
            {meta && <span class="m-muted m-small">{meta}</span>}
          </div>
          <Switch on={st.running} label="TorrServer на телефоне" disabled={starting} onToggle={() => void toggle()} />
        </div>
        {st.error && (
          <div class="m-error" role="alert">
            {st.error}
          </div>
        )}
        <div class="m-set-sep" />
        <div class="m-set-row">
          <div class="m-set-text" style="flex-grow: 1">
            <span>Запускать вместе с OMP</span>
            <span class="m-muted m-small">Сервер включается при открытии приложения</span>
          </div>
          <Switch on={localAutostart.value} label="Запускать вместе с OMP" onToggle={() => setAutostart(!localAutostart.value)} />
        </div>
        <div class="m-set-sep" />
        <div class="m-set-row">
          <div class="m-set-text" style="flex-grow: 1">
            <span>Кэш на телефоне</span>
            <span class="m-muted m-small">{bytes === null ? 'Считаю…' : 'Занято ' + formatBytes(bytes) + ' из 1 ГБ'}</span>
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" disabled={busy} onClick={() => void clear()}>
            Очистить
          </button>
        </div>
        {st.running && (
          <>
            <div class="m-set-sep" />
            <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'serverSettings', url: LOCAL_URL })}>
              <span>Настройки сервера</span>
              <Icon d="M9 6l6 6-6 6" size={18} />
            </button>
          </>
        )}
      </div>
      <div class="m-hint-ok">
        <Icon d="M12 8v.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18" size={18} />
        <span>Новая версия сервера приходит вместе с обновлением OMP</span>
      </div>
      <div class="m-hint-warn">Сервер доступен всем устройствам в этой сети Wi‑Fi</div>
      {st.vpn && <div class="m-hint-warn" role="alert">Включён VPN — другие устройства могут не видеть сервер. Разрешите в VPN доступ к локальной сети или выключите его.</div>}
    </section>
  );
}

/** OMP version on the connected TV; an old one gets «Обновить на ТВ». */
function TvOmpRow() {
  const connected = tvState.value === 'connected';
  const ip = activeTv.value ? activeTv.value.ip : '';
  const [v, setV] = useState<TvOmp | null>(null);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    setV(null);
    setHint(false);
    if (!connected) return;
    let alive = true;
    tvOmpVersions().then((r) => alive && setV(r));
    return () => {
      alive = false;
    };
  }, [connected, ip]);
  if (!connected || !v || !v.installed) return null;
  const installed = v.installed;
  const old = tvNeedsUpdate(v);
  const update = () => {
    const opens = tvOpensUpdate(installed);
    // older TV builds only open OMP: the update is started there by hand
    if (!opens) setHint(true);
    openUpdateOnTv().then(
      () => showToast(opens ? 'На телевизоре открыто обновление OMP' : 'OMP открыт на телевизоре'),
      (e) => showToast(errorMessage(e)),
    );
  };
  return (
    <>
      <div class="m-set-row" data-row="tv-omp">
        <div class="m-set-text">
          <span>OMP на телевизоре</span>
          <span class={'m-small' + (old ? ' m-accent' : ' m-muted')}>
            {old ? installed + ' — есть ' + v.latest : installed + (v.latest ? ' — последняя версия' : '')}
          </span>
        </div>
        {old && (
          <button type="button" class="m-btn m-btn-primary m-btn-sm" onClick={update}>
            Обновить на ТВ
          </button>
        )}
      </div>
      {hint && (
        <div class="m-hint-warn" role="status">
          Эта версия OMP на ТВ не открывает обновление сама. На телевизоре: Настройки → Обновление → «Проверить обновление».
        </div>
      )}
    </>
  );
}

export function Settings() {
  const server = activeServer.value;
  const tv = activeTv.value;
  const on = settings.value.updateCheck;

  async function check() {
    const r = await runUpdateCheck({ manual: true, url: ANDROID_UPDATE_URL }).catch((): CheckResult => 'error');
    if (r === 'error') showToast('Не удалось проверить обновления');
    else if (r === 'latest') showToast('У вас последняя версия');
  }

  return (
    <div class="m-screen" data-route="settings">
      <h1>Настройки</h1>
      {localServer.value.supported && <LocalServerSection />}
      <section class="m-set-group">
        <div class="m-set-label">Сервер</div>
        <div class="m-set-row">
          <div class="m-set-text">
            <span>{server ? server.name : 'Не выбран'}</span>
            {server && <span class="m-muted m-small">{server.url}</span>}
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => navigate({ name: 'connect' })}>
            Сменить
          </button>
        </div>
        {server && (
          <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'serverSettings' })}>
            <span>Настройки сервера</span>
            <Icon d="M9 6l6 6l-6 6" size={20} />
          </button>
        )}
      </section>
      <section class="m-set-group">
        <div class="m-set-label">Телевизор</div>
        <div class="m-set-row">
          <div class="m-set-text">
            <span>{tv ? tv.name : 'Не выбран'}</span>
            {tv && <span class="m-muted m-small">{tv.ip}</span>}
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => navigate({ name: 'tv' })}>
            Выбрать
          </button>
        </div>
        <TvOmpRow />
      </section>
      <section class="m-set-group">
        <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'faq' })}>
          <span>Вопросы и ответы</span>
          <Icon d="M9 6l6 6l-6 6" size={20} />
        </button>
      </section>
      <section class="m-set-group">
        <div class="m-set-label">О приложении</div>
        <div class="m-set-row">
          <span>Версия</span>
          <span class="m-muted">{APP_VERSION}</span>
        </div>
        <button type="button" class="m-btn m-btn-secondary" onClick={() => void check()}>
          Проверить обновления
        </button>
        <div class="m-set-row">
          <span>Проверять обновления при запуске</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Проверять обновления при запуске"
            class={'m-switch' + (on ? ' on' : '')}
            onClick={() => updateSettings({ updateCheck: !on })}
          >
            <span class="m-switch-knob" />
          </button>
        </div>
        <button type="button" class="m-btn m-btn-secondary" onClick={() => window.open(PROJECT_URL, '_system')}>
          Страница проекта
        </button>
        <button type="button" class="m-link" onClick={() => window.open(TORRSERVER_SOURCE_URL, '_system')}>
          TorrServer © YouROK, GPL-3.0
        </button>
      </section>
    </div>
  );
}
