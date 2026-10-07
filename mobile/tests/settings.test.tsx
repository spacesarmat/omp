import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Settings, setUpdateChecker } from '../src/screens/Settings';
import { currentRoute, resetTo } from '../src/nav';
import { settings, updateSettings } from '../../src/store/settings';
import { addServer, setActiveServer, removeServer, servers } from '../../src/store/servers';
import { ANDROID_UPDATE_URL, ANDROID_BETA_UPDATE_URL, type UpdateInfo } from '../../src/lib/updateInfo';
import { latestUpdate, updatePrompt } from '../../src/store/updates';
import { APP_VERSION } from '../../src/version';
import { whatsNew, closeWhatsNew } from '../../src/store/whatsNew';
import { toast } from '../src/ui/toast';
import { localServer, localAutostart, setLocalServerDeps, reloadLocalServerSettings } from '../src/server/localServer';
import { TORRSERVER_VERSION } from '../src/server/torrserverVersion';
import { activeServer } from '../../src/store/servers';
import * as tvUpdate from '../src/tv/tvUpdate';
import { tvState } from '../src/tv/tvClient';
import { saveTv, reloadTvs } from '../src/tv/tvStore';
import { native } from '../src/platform/native';
import { tvSearchOn } from '../src/tv/phoneRpc';

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(<Settings />, el));
  return el;
}
const btn = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t)!;

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  updateSettings({ updateCheck: true });
  toast.value = '';
  setUpdateChecker(null);
  resetTo({ name: 'settings' });
  reloadLocalServerSettings();
  localServer.value = { supported: false, running: false };
});

afterEach(() => {
  setLocalServerDeps(null);
  vi.restoreAllMocks();
  tvState.value = 'idle';
  localStorage.clear();
  reloadTvs();
});

describe('Settings', () => {
  it('the TV search row switches the phone search server off', async () => {
    const set = vi.spyOn(native, 'rpcSetEnabled').mockResolvedValue(null);
    saveTv({ ip: '192.168.1.50', name: 'LG' });
    const el = mount();
    const row = el.querySelector('[data-row="tv-search-service"]') as HTMLElement;
    expect(row.textContent).toContain('Поиск для телевизора');
    expect(row.textContent).toContain('В шторке будет тихое уведомление');
    const sw = row.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      sw.click();
    });
    expect(set).toHaveBeenLastCalledWith(false);
    expect(tvSearchOn.value).toBe(false);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(row.textContent).toContain('Выключено — телевизор ищет только через TorrServer (Rutor, Jackett)');
  });

  it('the update block comes first', () => {
    const el = mount();
    const labels = Array.from(el.querySelectorAll('.m-set-label')).map((n) => n.textContent);
    expect(labels[0]).toBe('Обновление');
    expect(labels[labels.length - 1]).toBe('О приложении');
    const first = el.querySelector('.m-set-group')!;
    expect(first.textContent).toContain('Проверить обновления');
    expect(first.textContent).toContain('Проверять обновления при запуске');
  });

  it('tap on «Версия» opens «Что нового» with the latest versions', async () => {
    const el = mount();
    const row = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.indexOf('Что нового ›') >= 0)!;
    expect(row.textContent).toContain(APP_VERSION);
    await act(async () => row.click());
    expect(whatsNew.value!.title).toBe('Что нового');
    expect(whatsNew.value!.auto).toBe(false);
    expect(whatsNew.value!.entries.length).toBeGreaterThan(0);
    expect(whatsNew.value!.entries.length).toBeLessThanOrEqual(6);
    closeWhatsNew();
  });

  it('shows version, server and navigates', async () => {
    const s = addServer({ url: 'http://192.168.1.5:8090', name: 'Home' });
    setActiveServer(s.id);
    const el = mount();
    expect(el.textContent).toContain(APP_VERSION);
    expect(el.textContent).toContain('Home');
    await act(async () => btn(el, 'Сменить').click());
    expect(currentRoute.value.name).toBe('connect');
    resetTo({ name: 'settings' });
    await act(async () => btn(el, 'Выбрать').click());
    expect(currentRoute.value.name).toBe('tv');
  });

  it('«Получать бета-версии» switches the check to the beta APK feed', async () => {
    const urls: (string | undefined)[] = [];
    setUpdateChecker(async (o) => {
      urls.push(o.url);
      return 'latest';
    });
    const el = mount();
    const sw = el.querySelector('[data-row="beta"] [role="switch"]') as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await act(async () => sw.click());
    expect(settings.value.betaUpdates).toBe(true);
    await act(async () => btn(el, 'Проверить обновления').click());
    await act(async () => {});
    expect(urls).toEqual([ANDROID_BETA_UPDATE_URL]);
    updateSettings({ betaUpdates: false });
  });

  it('manual check uses the Android feed and toasts the result', async () => {
    const urls: (string | undefined)[] = [];
    const manual: boolean[] = [];
    setUpdateChecker(async (o) => {
      urls.push(o.url);
      manual.push(o.manual);
      return 'latest';
    });
    const el = mount();
    await act(async () => btn(el, 'Проверить обновления').click());
    await act(async () => {});
    expect(urls).toEqual([ANDROID_UPDATE_URL]);
    expect(manual).toEqual([true]);
    expect(toast.value).toBe('У вас последняя версия');
    setUpdateChecker(async () => 'error');
    await act(async () => btn(el, 'Проверить обновления').click());
    await act(async () => {});
    expect(toast.value).toBe('Не удалось проверить обновления');
  });

  it('a found update stays offered in place of the check button, also after «Позже»', async () => {
    latestUpdate.value = { version: '9.0.0', ipkUrl: 'https://github.com/spacesarmat/omp/releases/download/v9.0.0/a.apk', ipkHash: 'b'.repeat(64), ipkSize: 1, notes: [], releaseUrl: 'https://example.com/r' } as UpdateInfo;
    updatePrompt.value = null;
    try {
      const el = mount();
      const row = el.querySelector<HTMLButtonElement>('[data-row="update-available"]')!;
      expect(row.textContent).toContain('9.0.0');
      expect(btn(el, 'Проверить обновления')).toBeUndefined();
      await act(async () => row.click());
      expect(updatePrompt.value!.version).toBe('9.0.0');
    } finally {
      latestUpdate.value = null;
      updatePrompt.value = null;
    }
  });

  it('toggles check on start', async () => {
    const el = mount();
    const sw = el.querySelector<HTMLElement>('[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await act(async () => sw.click());
    expect(settings.value.updateCheck).toBe(false);
  });

  it('opens the project page externally', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const el = mount();
    await act(async () => btn(el, 'Страница проекта').click());
    expect(open).toHaveBeenCalledWith('https://github.com/spacesarmat/omp', '_system');
    open.mockRestore();
  });

  it('credits TorrServer under GPL-3.0 with a link to its sources', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const el = mount();
    await act(async () => btn(el, 'TorrServer © YouROK, GPL-3.0').click());
    expect(open).toHaveBeenCalledWith('https://github.com/YouROK/TorrServer/tree/' + TORRSERVER_VERSION, '_system');
    expect(TORRSERVER_VERSION).toMatch(/^MatriX\./);
    open.mockRestore();
  });
});

describe('Settings: TorrServer on the phone', () => {
  function fake(state: { running: boolean; vpn?: boolean }, cache = { bytes: 412 * 1024 * 1024 }) {
    const calls: string[] = [];
    setLocalServerDeps({
      native: {
        async localServerInfo() {
          return state.running
            ? { supported: true, running: true, version: 'MatriX.145.1', ip: '192.168.1.50', ...(state.vpn ? { vpn: true } : {}) }
            : { supported: true, running: false };
        },
        async startLocalServer() {
          calls.push('start');
          state.running = true;
          return { supported: true, running: true };
        },
        async stopLocalServer() {
          calls.push('stop');
          state.running = false;
        },
        async localServerCache() {
          return cache.bytes;
        },
        async clearLocalServerCache() {
          calls.push('clear');
          cache.bytes = 0;
        },
        onLocalServerState: () => () => {},
      } as any,
    });
    return calls;
  }
  const flush = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

  it('is hidden when the phone does not support the server', async () => {
    const el = mount();
    await flush();
    expect(el.textContent).not.toContain('TorrServer на телефоне');
  });

  it('shows status, cache and the notes', async () => {
    fake({ running: true });
    localServer.value = { supported: true, running: true };
    const el = mount();
    await flush();
    const t = el.textContent!;
    expect(t).toContain('Работает');
    expect(t).toContain('MatriX.145.1 · 192.168.1.50:8090');
    expect(t).toContain('Кэш на телефоне');
    expect(t).toContain('Занято 412 МБ из 1 ГБ');
    expect(t).toContain('Новая версия сервера приходит вместе с обновлением OMP');
    expect(t).toContain('Сервер доступен всем устройствам в этой сети Wi‑Fi');
  });

  it('«Настройки сервера» opens the local server settings, only while it runs', async () => {
    fake({ running: false });
    localServer.value = { supported: true, running: false };
    const el0 = mount();
    await flush();
    expect(el0.querySelector('[data-section="local-server"]')!.textContent).not.toContain('Настройки сервера');
    fake({ running: true });
    localServer.value = { supported: true, running: true };
    const el = mount();
    await flush();
    const b = Array.from(el.querySelector('[data-section="local-server"]')!.querySelectorAll('button')).find((x) => (x.textContent || '').includes('Настройки сервера'))!;
    act(() => b.click());
    expect(currentRoute.value).toEqual({ name: 'serverSettings', url: 'http://127.0.0.1:8090' });
  });

  it('shows the VPN warning only while a VPN is active', async () => {
    fake({ running: true, vpn: true });
    localServer.value = { supported: true, running: true };
    const el = mount();
    await flush();
    expect(el.textContent).toContain('Включён VPN — другие устройства могут не видеть сервер. Разрешите в VPN доступ к локальной сети или выключите его.');
    fake({ running: true });
    localServer.value = { supported: true, running: true };
    const el2 = mount();
    await flush();
    expect(el2.textContent).not.toContain('Включён VPN');
  });

  it('switch starts and stops the server', async () => {
    const calls = fake({ running: false });
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    expect(el.textContent).toContain('Остановлен');
    await act(async () => el.querySelector<HTMLElement>('[aria-label="TorrServer на телефоне"]')!.click());
    await flush();
    expect(calls).toEqual(['start']);
    expect(el.textContent).toContain('Работает');
    await act(async () => el.querySelector<HTMLElement>('[aria-label="TorrServer на телефоне"]')!.click());
    await flush();
    expect(calls).toEqual(['start', 'stop']);
    expect(el.textContent).toContain('Остановлен');
  });

  it('without a downloaded binary the switch opens the setup screen; an outdated one offers the update', async () => {
    const calls: string[] = [];
    let binary = 'missing';
    setLocalServerDeps({
      native: {
        localServerInfo: async () => ({ supported: true, running: false, binary, downloadBytes: 64174032, pinVersion: 'MatriX.146' }),
        startLocalServer: async () => {
          calls.push('start');
          return { supported: true, running: true };
        },
        stopLocalServer: async () => {},
        localServerCache: async () => 0,
        clearLocalServerCache: async () => {},
        onLocalServerState: () => () => {},
      } as any,
    });
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    const section = () => el.querySelector('[data-section="local-server"]')!;
    expect(section().textContent).toContain('Не скачан');
    expect(section().textContent).toContain('Нужно скачать (~61 МБ)');
    await act(async () => el.querySelector<HTMLElement>('[aria-label="TorrServer на телефоне"]')!.click());
    await flush();
    expect(calls).toEqual([]);
    expect(currentRoute.value.name).toBe('localServer');

    resetTo({ name: 'settings' });
    binary = 'outdated';
    localServer.value = { supported: true, running: false };
    const el2 = mount();
    await flush();
    const s2 = el2.querySelector('[data-section="local-server"]')!;
    expect(s2.textContent).toContain('Остановлен');
    expect(s2.querySelector('[data-local="update"]')!.textContent).toContain('Новая версия TorrServerMatriX.146 · ~61 МБ');
    const upd = Array.from(s2.querySelectorAll('button')).find((b) => b.textContent === 'Обновить')!;
    await act(async () => upd.click());
    expect(currentRoute.value.name).toBe('localServer');
  });

  it('a server started from the switch joins the saved servers without becoming active', async () => {
    fake({ running: false });
    const home = addServer({ url: 'http://192.168.1.5:8090', name: 'Home' });
    setActiveServer(home.id);
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    await act(async () => el.querySelector<HTMLElement>('[aria-label="TorrServer на телефоне"]')!.click());
    await flush();
    expect(servers.value.map((s) => [s.name, s.url])).toEqual([
      ['Home', 'http://192.168.1.5:8090'],
      ['Этот телефон', 'http://127.0.0.1:8090'],
    ]);
    expect(activeServer.value?.id).toBe(home.id);
  });

  it('keeps a renamed local server as is and adds nothing when the start fails', async () => {
    fake({ running: false });
    const mine = addServer({ url: 'http://127.0.0.1:8090', name: 'Мой' });
    localServer.value = { supported: true, running: false };
    let el = mount();
    await flush();
    await act(async () => el.querySelector<HTMLElement>('[aria-label="TorrServer на телефоне"]')!.click());
    await flush();
    expect(servers.value).toEqual([mine]);

    removeServer(mine.id);
    setLocalServerDeps({
      native: {
        localServerInfo: async () => ({ supported: true, running: false }),
        startLocalServer: async () => {
          throw new Error('Не удалось запустить сервер');
        },
        localServerCache: async () => 0,
        onLocalServerState: () => () => {},
      } as any,
    });
    localServer.value = { supported: true, running: false };
    el = mount();
    await flush();
    await act(async () => el.querySelector<HTMLElement>('[aria-label="TorrServer на телефоне"]')!.click());
    await flush();
    expect(servers.value).toEqual([]);
    expect(el.textContent).toContain('Не удалось запустить сервер');
  });

  it('shows «Запускаю…» with the switch disabled while starting', async () => {
    let finish!: () => void;
    let running = false;
    setLocalServerDeps({
      native: {
        localServerInfo: async () => ({ supported: true, running }),
        startLocalServer: () =>
          new Promise((res) => {
            finish = () => {
              running = true;
              res({ supported: true, running: true });
            };
          }),
        localServerCache: async () => 0,
        onLocalServerState: () => () => {},
      } as any,
    });
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    const sw = () => el.querySelector<HTMLButtonElement>('[aria-label="TorrServer на телефоне"]')!;
    await act(async () => sw().click());
    expect(el.textContent).toContain('Запускаю…');
    expect(sw().disabled).toBe(true);
    await act(async () => finish());
    await flush();
    expect(el.textContent).not.toContain('Запускаю…');
    expect(el.textContent).toContain('Работает');
    expect(sw().disabled).toBe(false);
  });

  it('toggles autostart', async () => {
    fake({ running: false });
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    await act(async () => el.querySelector<HTMLElement>('[aria-label="Запускать вместе с OMP"]')!.click());
    expect(localAutostart.value).toBe(true);
    expect(JSON.parse(localStorage.getItem('tsp.localServer')!)).toEqual({ autostart: true });
  });

  it('clears the cache and re-reads its size', async () => {
    const calls = fake({ running: true });
    localServer.value = { supported: true, running: true };
    const el = mount();
    await flush();
    await act(async () => btn(el, 'Очистить').click());
    await flush();
    expect(calls).toContain('clear');
    expect(el.textContent).toContain('Занято 0 МБ из 1 ГБ');
  });
});

describe('Settings: OMP on the TV', () => {
  async function flush() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }
  const connect = () => {
    saveTv({ ip: '10.0.0.2', name: 'LG' });
    tvState.value = 'connected';
  };

  it('an old OMP on the TV gets «Обновить на ТВ», which opens the update there', async () => {
    connect();
    vi.spyOn(tvUpdate, 'tvOmpVersions').mockResolvedValue({ installed: '0.11.4', latest: '0.12.0' });
    const open = vi.spyOn(tvUpdate, 'openUpdateOnTv').mockResolvedValue(undefined);
    const el = mount();
    await flush();
    const row = el.querySelector('[data-row="tv-omp"]')!;
    expect(row.textContent).toContain('OMP на телевизоре');
    expect(row.textContent).toContain('0.11.4 — есть 0.12.0');
    act(() => btn(el, 'Обновить на ТВ').click());
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect(toast.value).toBe('На телевизоре открыто обновление OMP');
    expect(el.querySelector('.m-hint-warn')).toBeNull();
  });

  it('a TV build that cannot open the update screen gets the manual hint', async () => {
    connect();
    vi.spyOn(tvUpdate, 'tvOmpVersions').mockResolvedValue({ installed: '0.10.0', latest: '0.11.4' });
    vi.spyOn(tvUpdate, 'openUpdateOnTv').mockResolvedValue(undefined);
    const el = mount();
    await flush();
    act(() => btn(el, 'Обновить на ТВ').click());
    await flush();
    expect(el.querySelector('.m-hint-warn')!.textContent).toContain('Настройки → Обновление');
    expect(toast.value).toBe('OMP открыт на телевизоре');
  });

  it('the latest OMP shows no button; nothing without a connected TV', async () => {
    connect();
    vi.spyOn(tvUpdate, 'tvOmpVersions').mockResolvedValue({ installed: '0.11.4', latest: '0.11.4' });
    let el = mount();
    await flush();
    expect(el.querySelector('[data-row="tv-omp"]')!.textContent).toContain('0.11.4 — последняя версия');
    expect(btn(el, 'Обновить на ТВ')).toBeUndefined();
    tvState.value = 'idle';
    el = mount();
    await flush();
    expect(el.querySelector('[data-row="tv-omp"]')).toBeNull();
  });
});

describe('Settings «О приложении»: TMDB attribution', () => {
  it('names TMDB as the movie data source', () => {
    const el = mount();
    const about = Array.from(el.querySelectorAll('.m-set-group')).pop()!;
    expect(about.querySelector('.m-set-label')!.textContent).toBe('О приложении');
    expect(about.querySelector('.m-set-attr')!.textContent).toBe('Данные о фильмах: TMDB');
  });

  it('in English', () => {
    applyLanguageSetting('en');
    try {
      const el = mount();
      const about = Array.from(el.querySelectorAll('.m-set-group')).pop()!;
      expect(about.querySelector('.m-set-attr')!.textContent).toBe('Movie data: TMDB');
    } finally {
      applyLanguageSetting('ru');
    }
  });
});

describe('Settings in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));
  const noCyrillic = (el: HTMLElement) => expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  const local = (info: object) => {
    setLocalServerDeps({
      native: {
        localServerInfo: async () => info,
        startLocalServer: async () => ({ supported: true, running: true }),
        stopLocalServer: async () => {},
        localServerCache: async () => 412 * 1024 * 1024,
        clearLocalServerCache: async () => {},
        onLocalServerState: () => () => {},
      } as any,
    });
    localServer.value = { supported: true, running: false, ...info } as any;
  };

  it('title, sections, rows and buttons', () => {
    const el = mount();
    expect(el.querySelector('.m-screen-head h1')!.textContent).toBe('Settings');
    const labels = Array.from(el.querySelectorAll('.m-set-label')).map((n) => n.textContent);
    expect(labels).toEqual(['Update', 'Server', 'TV', 'About']);
    const text = el.textContent!;
    for (const w of ['Version', 'What’s new', 'Check for updates', 'Check for updates on start', 'Get beta versions', 'Not chosen', 'Change', 'Choose', 'Search sources', 'Monitoring', 'Install OMP on the TV', 'Questions and answers', 'Backup', 'Error log', 'Project page']) {
      expect(text, w).toContain(w);
    }
    expect(el.querySelector('[data-row="language"]')!.textContent).toBe('LanguageAs on the device ›');
    noCyrillic(el);
  });

  it('the beta switch shows the English hint', () => {
    const el = mount();
    expect(el.querySelector('[data-row="beta"]')!.textContent).toBe('Get beta versions' + 'New features first. There may be bugs. When the main version is out, it replaces the beta');
    expect(el.querySelector('[role=switch][aria-label="Get beta versions"]')).toBeTruthy();
    expect(el.querySelector('[role=switch][aria-label="Check for updates on start"]')).toBeTruthy();
  });

  it('manual update check toasts in English', async () => {
    setUpdateChecker(async () => 'latest');
    const el = mount();
    await act(async () => btn(el, 'Check for updates').click());
    expect(toast.value).toBe('You have the latest version');
    setUpdateChecker(async () => 'error');
    await act(async () => btn(el, 'Check for updates').click());
    expect(toast.value).toBe('Could not check for updates');
  });

  it('the phone server: status, cache, notes and the VPN warning', async () => {
    local({ supported: true, running: true, version: 'MatriX.145.1', ip: '192.168.1.50', vpn: true });
    const el = mount();
    await flush();
    const section = el.querySelector('[data-section="local-server"]')!;
    const t = section.textContent!;
    expect(t).toContain('TorrServer on the phone');
    expect(t).toContain('Working');
    expect(t).toContain('MatriX.145.1 · 192.168.1.50:8090');
    expect(t).toContain('Start together with OMP');
    expect(t).toContain('The server starts when the app opens');
    expect(t).toContain('Cache on the phone');
    expect(t).toContain('Used 412 MB of 1 GB');
    expect(t).toContain('Server settings');
    expect(t).toContain('A new server version comes with an OMP update');
    expect(t).toContain('The server is available to all devices on this Wi‑Fi network');
    expect(t).toContain('VPN is on');
    expect(Array.from(section.querySelectorAll('button')).map((b) => b.textContent)).toContain('Clear');
    noCyrillic(el);
  });

  it('the phone server: not downloaded, and an outdated one offers the update', async () => {
    local({ supported: true, running: false, binary: 'missing' });
    const el = mount();
    await flush();
    const text = el.querySelector('[data-section="local-server"]')!.textContent!;
    expect(text).toContain('Not downloaded');
    expect(text).toContain('Needs downloading');
    noCyrillic(el);
    resetTo({ name: 'settings' });
    local({ supported: true, running: false, binary: 'outdated', pinVersion: 'MatriX.146' });
    const el2 = mount();
    await flush();
    const s2 = el2.querySelector('[data-section="local-server"]')!;
    expect(s2.textContent).toContain('Stopped');
    expect(s2.querySelector('[data-local="update"]')!.textContent).toBe('New TorrServer versionMatriX.146Update');
    noCyrillic(el2);
  });

  it('OMP on the TV: the version line, the button, the toast and the manual hint', async () => {
    saveTv({ ip: '10.0.0.2', name: 'LG' });
    tvState.value = 'connected';
    vi.spyOn(tvUpdate, 'tvOmpVersions').mockResolvedValue({ installed: '0.10.0', latest: '0.11.4' });
    vi.spyOn(tvUpdate, 'openUpdateOnTv').mockResolvedValue(undefined);
    const el = mount();
    await flush();
    const row = el.querySelector('[data-row="tv-omp"]')!;
    expect(row.textContent).toContain('OMP on the TV');
    expect(row.textContent).toContain('0.10.0 — 0.11.4 is available');
    act(() => btn(el, 'Update on the TV').click());
    await flush();
    expect(toast.value).toBe('OMP is open on the TV');
    expect(el.querySelector('.m-hint-warn')!.textContent).toContain('Settings → Update');
    noCyrillic(el);
  });
});

describe('Settings: «Плеер для видео»', () => {
  const flushAll = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
  afterEach(() => updateSettings({ videoPlayer: 'builtin' }));

  it('2160 Player installed: both options work and the choice is kept', async () => {
    vi.spyOn(native, 'player2160').mockResolvedValue('pkg');
    const el = mount();
    await flushAll();
    const row = el.querySelector('[data-row="video-player"]')!;
    const [b, p] = Array.from(row.querySelectorAll('.m-seg button')) as HTMLButtonElement[];
    expect(b.textContent).toBe('Выбор Android');
    expect(p.textContent).toBe('2160 Player');
    expect(p.disabled).toBe(false);
    expect(row.querySelector('[data-row="p2160-missing"]')).toBeNull();
    act(() => p.click());
    expect(settings.value.videoPlayer).toBe('p2160');
    act(() => b.click());
    expect(settings.value.videoPlayer).toBe('builtin');
    expect(row.textContent).toContain('Без 2160 Player видео откроется в приложении, которое вы выберете');
  });

  it('not installed: 2160 is disabled and the link opens the release page', async () => {
    vi.spyOn(native, 'player2160').mockResolvedValue(null);
    const win = vi.spyOn(window, 'open').mockReturnValue(null);
    const el = mount();
    await flushAll();
    const row = el.querySelector('[data-row="video-player"]')!;
    expect((row.querySelectorAll('.m-seg button')[1] as HTMLButtonElement).disabled).toBe(true);
    act(() => (row.querySelector('[data-row="p2160-missing"]') as HTMLElement).click());
    expect(win).toHaveBeenCalledWith('https://github.com/spacesarmat/2160player/releases/latest', '_system');
  });
});
