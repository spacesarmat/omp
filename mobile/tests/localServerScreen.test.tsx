import { applyLanguageSetting } from '../../src/i18n';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LocalServer } from '../src/screens/LocalServer';
import { TORRSERVER_VERSION } from '../src/server/torrserverVersion';
import { setLocalServerDeps, localServer, reloadLocalServerSettings } from '../src/server/localServer';
import { currentRoute, resetTo, navigate } from '../src/nav';
import { activeServer, setActiveServer, removeServer, servers } from '../../src/store/servers';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(<LocalServer />, el));
  return el;
}

function deps(over: { echoFails?: number; vpn?: boolean } = {}) {
  let fails = over.echoFails ?? 0;
  let running = false;
  return {
    native: {
      async localServerInfo() {
        return running
          ? { supported: true, running, version: 'MatriX.145.1', ip: '192.168.1.50', ...(over.vpn ? { vpn: true } : {}) }
          : { supported: true, running };
      },
      async startLocalServer() {
        running = true;
        return { supported: true, running };
      },
      async stopLocalServer() {},
      async localServerCache() {
        return 0;
      },
      async clearLocalServerCache() {},
      onLocalServerState: () => () => {},
    } as any,
    echo: async () => {
      if (fails-- > 0) throw new Error('Сервер не отвечает');
      return 'MatriX.145.1';
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  reloadLocalServerSettings();
  localServer.value = { supported: true, running: false };
  resetTo({ name: 'connect' });
});
afterEach(() => setLocalServerDeps(null));

describe('LocalServer screen', () => {
  it('warns about an active VPN, and only then', async () => {
    setLocalServerDeps(deps({ vpn: true }));
    const el = mount();
    await flush();
    expect(el.textContent).toContain('Включён VPN — другие устройства могут не видеть сервер. Разрешите в VPN доступ к локальной сети или выключите его.');
    setLocalServerDeps(deps());
    const el2 = mount();
    await flush();
    expect(el2.textContent).not.toContain('Включён VPN');
  });

  it('walks the steps, shows the address and opens the catalog', async () => {
    setLocalServerDeps(deps());
    const el = mount();
    await flush();
    const text = el.textContent!;
    expect(text).toContain('TorrServer на телефоне');
    // the pinned version (torrserver.version), not a literal: the TorrServer update bumps it
    expect(text).toContain('Подготовка сервера ' + TORRSERVER_VERSION);
    expect(text).toContain('Запуск в фоне');
    expect(text).toContain('Проверка связи');
    expect(text).toContain('Подключение OMP');
    expect(el.querySelectorAll('.m-step.ok')).toHaveLength(4);
    expect(text).toContain('Адрес для телевизора');
    expect(text).toContain('192.168.1.50:8090');
    expect(text).toContain('На ТВ: Вход → «Найти в сети». Сервер работает, пока телефон включён и в этой сети Wi‑Fi.');
    expect(activeServer.value).toMatchObject({ name: 'Этот телефон', url: 'http://127.0.0.1:8090' });
    const open = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Открыть каталог')!;
    await act(async () => open.click());
    expect(currentRoute.value.name).toBe('library');
  });

  function downloadDeps(
    over: { binary?: 'missing' | 'outdated'; fail?: { message: string; code: string } | null; mobileData?: boolean; bytes?: number | null } = {},
  ) {
    const calls: string[] = [];
    let binary: string = over.binary ?? 'missing';
    let running = false;
    let downloading = false;
    let percent = 0;
    let fail = over.fail ?? null;
    let progress: ((p: any) => void) | null = null;
    let finish: (() => void) | null = null;
    let reject: ((e: any) => void) | null = null;
    const native = {
      async localServerInfo() {
        calls.push('info');
        return {
          supported: true,
          running,
          binary,
          ...(over.bytes === null ? {} : { downloadBytes: over.bytes ?? 64174032 }),
          pinVersion: 'MatriX.146',
          ...(running ? { version: 'MatriX.146', ip: '192.168.1.50' } : {}),
          ...(downloading ? { downloading: true, downloadPercent: percent } : {}),
          ...(over.mobileData ? { mobileData: true } : {}),
        };
      },
      downloadLocalServer(cb: (p: any) => void) {
        calls.push('download');
        progress = (p: any) => {
          if (typeof p.percent === 'number') percent = p.percent;
          cb(p);
        };
        downloading = true;
        return new Promise((res, rej) => {
          finish = () => {
            binary = 'ready';
            downloading = false;
            res({ supported: true, running, binary });
          };
          reject = (e: any) => {
            downloading = false;
            rej(e);
          };
        });
      },
      async cancelLocalServerDownload() {
        calls.push('cancel');
        const e: any = new Error('Загрузка отменена');
        e.code = 'cancelled';
        reject!(e);
      },
      async startLocalServer() {
        calls.push('start');
        running = true;
        return { supported: true, running };
      },
      async stopLocalServer() {
        calls.push('stop');
      },
      async localServerCache() {
        return 0;
      },
      async clearLocalServerCache() {},
      onLocalServerState: () => () => {},
    };
    return {
      calls,
      progress: (p: any) => progress!(p),
      finish: () => {
        if (fail) {
          const e: any = new Error(fail.message);
          e.code = fail.code;
          fail = null;
          reject!(e);
        } else finish!();
      },
      deps: { native: native as any, echo: async () => 'MatriX.146' },
    };
  }

  const button = (el: HTMLElement, text: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === text);

  it('offers the download first, shows progress, then starts as before', async () => {
    const d = downloadDeps();
    setLocalServerDeps(d.deps);
    const el = mount();
    await flush();
    expect(el.textContent).toContain('TorrServer не входит в установочный файл OMP. Его нужно один раз скачать с GitHub (версия MatriX.146), лучше по Wi‑Fi.');
    expect(d.calls).toEqual(['info']);
    await act(async () => button(el, 'Скачать TorrServer (~61 МБ)')!.click());
    await flush();
    expect(d.calls).toContain('download');
    await act(async () => d.progress({ phase: 'download', percent: 42 }));
    const first = el.querySelector('.m-step')!;
    // the title stays on one line: the percentage lives under the bar only
    expect(first.querySelector('.m-step-label')!.textContent).toBe('Скачивание TorrServer MatriX.146');
    expect(el.textContent).not.toContain('· 42%');
    // the bar sits inside the card, under the current step, with the size line under it
    expect(first.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
    expect(first.querySelector('.m-step-sub')!.textContent).toBe('42% · 26 из 61 МБ');
    expect(button(el, 'Отмена')).toBeTruthy();
    expect(button(el, 'Отмена')!.closest('.m-local-actions')).toBeTruthy();
    await act(async () => d.progress({ phase: 'verify' }));
    expect(el.textContent).toContain('Проверка файла TorrServer MatriX.146');
    expect(button(el, 'Отмена')).toBeUndefined();
    await act(async () => d.finish());
    await flush();
    expect(el.querySelectorAll('.m-step.ok')).toHaveLength(4);
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
    expect(el.textContent).toContain('192.168.1.50:8090');
    expect(d.calls.filter((c) => c === 'start')).toHaveLength(1);
    expect(activeServer.value).toMatchObject({ url: 'http://127.0.0.1:8090' });
  });

  it('cancelling the download returns to the offer', async () => {
    const d = downloadDeps();
    setLocalServerDeps(d.deps);
    const el = mount();
    await flush();
    await act(async () => button(el, 'Скачать TorrServer (~61 МБ)')!.click());
    await flush();
    await act(async () => d.progress({ phase: 'download', percent: 5 }));
    await act(async () => button(el, 'Отмена')!.click());
    await flush();
    expect(d.calls).toContain('cancel');
    expect(button(el, 'Скачать TorrServer (~61 МБ)')).toBeTruthy();
    expect(el.querySelector('.m-error')).toBeNull();
    expect(d.calls).not.toContain('start');
  });

  it('a failed download shows the next step and retries the download', async () => {
    const d = downloadDeps({ fail: { message: 'Не удалось скачать TorrServer: нет связи с GitHub. Проверьте интернет и повторите.', code: 'network' } });
    setLocalServerDeps(d.deps);
    const el = mount();
    await flush();
    await act(async () => button(el, 'Скачать TorrServer (~61 МБ)')!.click());
    await flush();
    await act(async () => d.finish());
    await flush();
    expect(el.querySelector('.m-error')?.textContent).toBe('Не удалось скачать TorrServer: нет связи с GitHub. Проверьте интернет и повторите.');
    expect(el.querySelector('.m-step.fail')?.textContent).toContain('Подготовка сервера MatriX.146');
    await act(async () => button(el, 'Повторить')!.click());
    await flush();
    expect(d.calls.filter((c) => c === 'download')).toHaveLength(2);
    await act(async () => d.finish());
    await flush();
    expect(el.textContent).toContain('Открыть каталог');
  });

  it('an outdated binary offers the update or a start of the current version', async () => {
    const d = downloadDeps({ binary: 'outdated' });
    setLocalServerDeps(d.deps);
    const el = mount();
    await flush();
    expect(el.textContent).toContain('Вышла новая версия встроенного TorrServer — MatriX.146.');
    expect(button(el, 'Обновить TorrServer (~61 МБ)')).toBeTruthy();
    await act(async () => button(el, 'Запустить текущую версию')!.click());
    await flush();
    expect(d.calls).not.toContain('download');
    expect(el.textContent).toContain('Открыть каталог');
  });

  it('reopening the screen during a download shows its progress, and leaving does not start the server', async () => {
    const d = downloadDeps();
    setLocalServerDeps(d.deps);
    const el = mount();
    await flush();
    await act(async () => button(el, 'Скачать TorrServer (~61 МБ)')!.click());
    await flush();
    await act(async () => d.progress({ phase: 'download', percent: 30 }));
    // leave the screen: the download keeps running
    act(() => render(null, el));
    const el2 = mount();
    await flush();
    expect(button(el2, 'Скачать TorrServer (~61 МБ)')).toBeUndefined();
    expect(el2.querySelector('.m-step-label')!.textContent).toBe('Скачивание TorrServer MatriX.146');
    expect(el2.querySelector('.m-step-sub')!.textContent).toBe('30% · 18 из 61 МБ');
    await act(async () => d.progress({ phase: 'download', percent: 70 }));
    expect(el2.querySelector('.m-step-sub')!.textContent).toBe('70% · 43 из 61 МБ');
    await act(async () => d.finish());
    await flush();
    expect(el2.textContent).toContain('Открыть каталог');
    // one start only: the first (left) screen did not start the server after the download
    expect(d.calls.filter((c) => c === 'start')).toHaveLength(1);
  });

  it('without a known size the line under the bar is the percentage only', async () => {
    const d = downloadDeps({ bytes: null });
    setLocalServerDeps(d.deps);
    const el = mount();
    await flush();
    await act(async () => button(el, 'Скачать TorrServer')!.click());
    await flush();
    await act(async () => d.progress({ phase: 'download', percent: 39 }));
    expect(el.querySelector('.m-step-sub')!.textContent).toBe('39%');
    expect(el.querySelector('.m-step-label')!.textContent).toBe('Скачивание TorrServer MatriX.146');
  });

  it('step icons: a check when done, a spinner for the current step, numbers for the next ones', async () => {
    const d = downloadDeps();
    setLocalServerDeps(d.deps);
    const el = mount();
    await flush();
    await act(async () => button(el, 'Скачать TorrServer (~61 МБ)')!.click());
    await flush();
    await act(async () => d.progress({ phase: 'download', percent: 10 }));
    const steps = Array.from(el.querySelectorAll('.m-step'));
    expect(steps.map((s) => s.getAttribute('data-state'))).toEqual(['run', 'wait', 'wait', 'wait']);
    expect(steps[0].querySelector('.m-step-dot svg.m-spin')).toBeTruthy();
    expect(steps.slice(1).map((s) => s.querySelector('.m-step-dot')!.textContent)).toEqual(['2', '3', '4']);
    expect(steps[1].querySelector('.m-step-dot svg')).toBeNull();
    await act(async () => d.finish());
    await flush();
    for (const s of Array.from(el.querySelectorAll('.m-step'))) {
      expect(s.getAttribute('data-state')).toBe('ok');
      expect(s.querySelector('.m-step-dot svg')).toBeTruthy();
      expect(s.querySelector('.m-step-num')).toBeNull();
    }
    expect(el.querySelector('.m-spin')).toBeNull();
  });

  it('has a subpage header with «Назад»', async () => {
    navigate({ name: 'localServer' });
    setLocalServerDeps(deps());
    const el = mount();
    await flush();
    const bar = el.querySelector('.m-bar')!;
    expect(bar.querySelector('h1')!.textContent).toBe('TorrServer на телефоне');
    const back = bar.querySelector('button[aria-label="Назад"]') as HTMLButtonElement;
    expect(back).toBeTruthy();
    await act(async () => back.click());
    expect(currentRoute.value.name).toBe('connect');
  });

  it('the offer screen has the same header', async () => {
    setLocalServerDeps(downloadDeps().deps);
    const el = mount();
    await flush();
    expect(el.querySelector('.m-bar h1')!.textContent).toBe('TorrServer на телефоне');
    expect(el.querySelector('.m-bar button[aria-label="Назад"]')).toBeTruthy();
  });

  it('a download finished after leaving the screen starts nothing', async () => {
    const d = downloadDeps();
    setLocalServerDeps(d.deps);
    const el = mount();
    await flush();
    await act(async () => button(el, 'Скачать TorrServer (~61 МБ)')!.click());
    await flush();
    act(() => render(null, el));
    await act(async () => d.finish());
    await flush();
    expect(d.calls).not.toContain('start');
    expect(servers.value).toHaveLength(0);
  });

  it('on mobile data the download is confirmed first', async () => {
    const d = downloadDeps({ mobileData: true });
    setLocalServerDeps(d.deps);
    const el = mount();
    await flush();
    await act(async () => button(el, 'Скачать TorrServer (~61 МБ)')!.click());
    expect(el.textContent).toContain('Скачать 61 МБ через мобильный интернет?');
    expect(d.calls).not.toContain('download');
    await act(async () => button(el, 'Отмена')!.click());
    expect(button(el, 'Скачать TorrServer (~61 МБ)')).toBeTruthy();
    await act(async () => button(el, 'Скачать TorrServer (~61 МБ)')!.click());
    await act(async () => button(el, 'Скачать')!.click());
    await flush();
    expect(d.calls).toContain('download');
  });

  it('shows the error at the failing step and retries', async () => {
    setLocalServerDeps(deps({ echoFails: 1 }));
    const el = mount();
    await flush();
    expect(el.querySelector('.m-error')?.textContent).toBe('Сервер не отвечает');
    expect(el.querySelector('.m-step.fail')?.textContent).toContain('Проверка связи');
    // the red mark and the error text under the failed step; the earlier steps done, the last one numbered
    const fail = el.querySelector('.m-step.fail')!;
    expect(fail.querySelector('.m-step-dot svg')).toBeTruthy();
    expect(fail.querySelector('.m-step-error')!.textContent).toBe('Сервер не отвечает');
    expect(Array.from(el.querySelectorAll('.m-step')).map((s) => s.getAttribute('data-state'))).toEqual(['ok', 'ok', 'fail', 'wait']);
    expect(el.querySelectorAll('.m-step')[3].querySelector('.m-step-dot')!.textContent).toBe('4');
    expect(button(el, 'Повторить')!.closest('.m-local-actions')).toBeTruthy();
    expect(el.textContent).not.toContain('Открыть каталог');
    const retry = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Повторить')!;
    await act(async () => retry.click());
    await flush();
    expect(el.querySelector('.m-error')).toBeNull();
    expect(el.textContent).toContain('Открыть каталог');
    expect(servers.value).toHaveLength(1);
  });
});

describe('LocalServer screen in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));
  const CYR = /[А-Яа-яЁё]/;
  const btn = (el: HTMLElement, text: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === text);
  // the binary has to be downloaded; no size is given (the size text comes from server/localServer)
  const offerDeps = (over: { binary: 'missing' | 'outdated'; mobileData?: boolean }) => ({
    native: {
      async localServerInfo() {
        return { supported: true, running: false, binary: over.binary, pinVersion: 'MatriX.146', ...(over.mobileData ? { mobileData: true } : {}) };
      },
    } as any,
  });

  it('steps, address for the TV and the VPN warning', async () => {
    setLocalServerDeps(deps({ vpn: true }));
    const el = mount();
    await flush();
    expect(el.querySelector('h1')!.textContent).toBe('TorrServer on the phone');
    const steps = Array.from(el.querySelectorAll('.m-step-label')).map((n) => n.textContent);
    expect(steps.slice(1)).toEqual(['Starting in the background', 'Checking the connection', 'Connecting OMP']);
    expect(el.textContent).toContain('Address for the TV');
    expect(el.textContent).toContain('VPN is on — other devices may not see the server.');
    expect(el.textContent).toContain('On the TV: Sign in → “Find on network”.');
    expect(btn(el, 'Open the catalog')).toBeTruthy();
    expect(el.textContent).not.toMatch(CYR);
  });

  it('the download offer, the update offer and the mobile data question', async () => {
    setLocalServerDeps(offerDeps({ binary: 'missing' }));
    const el = mount();
    await flush();
    expect(el.textContent).toContain('TorrServer is not part of the OMP installation file. It has to be downloaded once from GitHub (version MatriX.146), preferably over Wi‑Fi.');
    expect(btn(el, 'Download TorrServer')).toBeTruthy();
    expect(el.textContent).not.toMatch(CYR);
    setLocalServerDeps(offerDeps({ binary: 'outdated' }));
    const el2 = mount();
    await flush();
    expect(el2.textContent).toContain('A new version of the built-in TorrServer is out — MatriX.146.');
    expect(btn(el2, 'Update TorrServer')).toBeTruthy();
    expect(btn(el2, 'Run the current version')).toBeTruthy();
    setLocalServerDeps(offerDeps({ binary: 'missing', mobileData: true }));
    const el3 = mount();
    await flush();
    await act(async () => btn(el3, 'Download TorrServer')!.click());
    expect(el3.textContent).toContain('Download TorrServer over mobile data?');
    expect(el3.textContent).toContain('The phone is not on Wi‑Fi right now.');
    expect(btn(el3, 'Download')).toBeTruthy();
    expect(btn(el3, 'Cancel')).toBeTruthy();
    expect(el3.textContent).not.toMatch(CYR);
  });

  it('a failed step offers a retry', async () => {
    setLocalServerDeps(deps({ echoFails: 1 }));
    const el = mount();
    await flush();
    expect(el.querySelector('.m-step.fail')!.textContent).toContain('Checking the connection');
    expect(btn(el, 'Retry')).toBeTruthy();
  });
});
