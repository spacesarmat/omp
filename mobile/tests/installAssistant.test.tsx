import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { mockFetch } from '../../tests/helpers/fetchMock';
import { InstallAssistant } from '../src/screens/InstallAssistant';
import { setInstallerNative, InstallError, type InstallerNative, type InstallRequest, type InstallEvent, type InstallResult } from '../src/install/installer';
import { monitorNative } from '../src/monitor/native';
import { logEntries, clearLog } from '../../src/lib/log';
import { Settings } from '../src/screens/Settings';
import { Tv, setTvDiscoverer, setAtvDiscoverer } from '../src/screens/Tv';
import { Faq } from '../src/screens/Faq';
import { setInstallNative, type InstallNative } from '../src/install/devices';
import { setTransport, disconnectTv, connectTv, type TvTransport } from '../src/tv/tvClient';
import { reloadTvs, saveTv, activeTvIp, tvs } from '../src/tv/tvStore';
import { sessionIp, tvState } from '../src/tv/tvClient';
import { currentRoute, resetTo, navigate } from '../src/nav';
import { native } from '../src/platform/native';
import { UPDATE_URL, ANDROID_UPDATE_URL } from '../../src/lib/updateInfo';
import { FAQ_LG_DEVMODE } from '../../src/lib/installPlan';
import { toast } from '../src/ui/toast';

const LG_IP = '192.168.1.5';
const ATV_IP = '192.168.1.9';
const HASH = 'a'.repeat(64);

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** SSAP fake: accepts pairing (or declines it) and answers requests from `answers` by URI. */
class FakeLg implements TvTransport {
  sent: any[] = [];
  connects: string[] = [];
  decline = false;
  answers: Record<string, any> = {};
  private cbs = new Set<(m: any) => void>();
  async tvConnect(ip: string, register: any) {
    this.connects.push(ip);
    queueMicrotask(() =>
      this.emit(
        this.decline
          ? { type: 'error', id: register.id, error: '403 denied' }
          : { type: 'registered', id: register.id, payload: { 'client-key': 'K' } },
      ),
    );
    return { port: 3000 as const };
  }
  async tvSend(m: any) {
    this.sent.push(m);
    const a = this.answers[m.uri];
    if (a === undefined) return; // silent
    queueMicrotask(() => this.emit({ type: 'response', id: m.id, payload: { returnValue: true, ...a } }));
  }
  onTvMessage(cb: (m: any) => void) {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }
  onTvClosed() {
    return () => {};
  }
  async pointerConnect() {}
  async pointerSend() {}
  async tvDisconnect() {}
  emit(m: any) {
    for (const cb of [...this.cbs]) cb(m);
  }
  launches() {
    return this.sent.filter((m) => m.uri === 'ssap://system.launcher/launch').map((m) => m.payload);
  }
}

let lg: FakeLg;
let probed: { ip: string; ports: number[] }[];
let openPorts: number[];
let stops = 0;
let fakeNative: InstallNative;

function apps(...list: Array<{ id: string; version?: string }>) {
  return { apps: [{ id: 'com.webos.app.browser', version: '1.0' }, ...list] };
}

function mount(node: preact.ComponentChild): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(node, el));
  return el;
}

const button = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement | undefined;
const click = (b: HTMLElement | undefined) => {
  if (!b) throw new Error('no button');
  act(() => b.click());
};
function type(input: HTMLInputElement, value: string) {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  toast.value = '';
  lg = new FakeLg();
  lg.answers = {
    'ssap://system/getSystemInfo': { modelName: 'OLED55C1RLA' },
    'ssap://com.webos.service.update/getCurrentSWInformation': {
      product_name: 'webOSTV 6.0',
      model_name: 'HE_DTV_W21O_AFABATAA',
      device_id: 'aa:bb:cc:dd:ee:ff',
    },
    'ssap://com.webos.applicationManager/listApps': apps(),
    'ssap://system.launcher/launch': {},
    'ssap://com.webos.service.connectionmanager/getinfo': {},
  };
  setTransport(lg);
  probed = [];
  openPorts = [];
  stops = 0;
  fakeNative = {
    discoverTvs: async () => [{ ip: LG_IP, name: 'LG «Гостиная»', model: 'OLED55C1' }],
    discoverCastTvs: async () => [
      { ip: ATV_IP, name: 'Chromecast «Спальня»', model: 'Google TV' },
      { ip: '192.168.1.30', name: 'Колонка', model: 'Nest Audio' },
    ],
    discoverOmpTvs: async () => [{ ip: '192.168.1.20', port: 8095, name: 'Кухня', version: '0.12.1' }],
    probePorts: async (ip, ports) => {
      probed.push({ ip, ports });
      return openPorts.filter((p) => ports.indexOf(p) >= 0);
    },
    stopDiscovery: async () => {
      stops++;
    },
  };
  setInstallNative(fakeNative);
  mockFetch((url) => {
    if (url.indexOf(UPDATE_URL) === 0) return { body: JSON.stringify({ version: '0.13.1', ipkUrl: 'https://x/omp.ipk', ipkHash: HASH }) };
    if (url.indexOf(ANDROID_UPDATE_URL) === 0) return { body: JSON.stringify({ version: '0.13.1', ipkUrl: 'https://x/omp.apk', ipkHash: HASH }) };
    return { status: 404, body: '' };
  });
  resetTo({ name: 'settings' });
});

afterEach(async () => {
  act(() => render(null, document.getElementById('app')!));
  setInstallNative(null);
  setInstallerNative(null);
  vi.restoreAllMocks();
  setTvDiscoverer(null);
  setAtvDiscoverer(null);
  await disconnectTv();
  setTransport(native);
  vi.unstubAllGlobals();
});

describe('Install assistant — device list', () => {
  it('lists LG and Android TVs with their state, hides speakers', async () => {
    const el = mount(<InstallAssistant />);
    expect(el.textContent).toContain('Ищу устройства…');
    await flush();
    const names = Array.from(el.querySelectorAll('.m-install-dev-name')).map((n) => n.textContent);
    expect(names).toEqual(['LG «Гостиная»', 'Chromecast «Спальня»', 'Кухня']);
    const rows = Array.from(el.querySelectorAll('.m-install-dev')).map((n) => n.textContent);
    expect(rows[0]).toContain('OLED55C1 · LG webOS');
    expect(rows[0]).toContain('Подключусь и проверю, что установлено');
    expect(rows[1]).toContain('OMP не найден');
    expect(rows[2]).toContain('OMP 0.12.1 — есть 0.13.1');
    expect(el.textContent).not.toContain('Ищу устройства…');
    expect(el.textContent).toContain('Samsung (Tizen) пока не поддерживается.');
  });

  it('a tap opens the steps of that device', async () => {
    resetTo({ name: 'install' });
    const el = mount(<InstallAssistant />);
    await flush();
    click(el.querySelectorAll<HTMLButtonElement>('.m-install-dev')[1]);
    expect(currentRoute.value).toEqual({ name: 'install', ip: ATV_IP, kind: 'atv' });
  });

  it('manual IP: checks the address and opens the steps for the chosen kind', async () => {
    resetTo({ name: 'install' });
    const el = mount(<InstallAssistant />);
    await flush();
    click(button(el, 'Ввести IP вручную'));
    const input = el.querySelector<HTMLInputElement>('#install-ip')!;
    type(input, '192.168.1');
    click(button(el, 'Показать шаги'));
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('192.168.1.42');
    type(input, '192.168.1.66');
    click(button(el, 'Android TV'));
    click(button(el, 'Показать шаги'));
    expect(currentRoute.value).toEqual({ name: 'install', ip: '192.168.1.66', kind: 'atv' });
  });

  it('nothing found: says so and searches again', async () => {
    let calls = 0;
    setInstallNative({ ...fakeNative, discoverTvs: async () => (calls++, []), discoverCastTvs: async () => [], discoverOmpTvs: async () => [] });
    const el = mount(<InstallAssistant />);
    await flush();
    expect(el.textContent).toContain('Ничего не нашлось');
    click(button(el, 'Искать снова'));
    await flush();
    expect(calls).toBe(2);
  });
});

describe('Install assistant — LG steps', () => {
  it('pairs, reads the TV and shows the Developer Mode path; outside the Android app «Установить» is off', async () => {
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    expect(el.textContent).toContain('Проверяю телевизор…');
    await flush();
    expect(el.querySelector('.m-bar-title')!.textContent).toBe('LG «Гостиная»');
    expect(el.textContent).toContain('OLED55C1RLA · webOS 6.0 · без root — ставим через режим разработчика');
    const steps = Array.from(el.querySelectorAll('.m-install-step'));
    expect(steps.map((s) => s.className.split(' ').pop())).toEqual(['current', 'todo', 'todo', 'todo', 'todo', 'todo']);
    expect(steps[0].getAttribute('aria-current')).toBe('step');
    expect(probed).toEqual([{ ip: LG_IP, ports: [9922, 9991] }]);
    const install = button(el, 'Установить OMP и Homebrew Channel')!;
    expect(install.disabled).toBe(true);
    expect(el.textContent).toContain('Установка с телефона работает в приложении OMP для Android.');
    expect(el.querySelector('#install-pass')).not.toBeNull();
    expect(button(el, 'Можно ли получить root на этой модели')).toBeDefined();
  });

  it('Dev Mode ports open: the first steps are done', async () => {
    openPorts = [9922, 9991];
    lg.answers['ssap://com.webos.applicationManager/listApps'] = apps({ id: 'com.palmdts.devmode', version: '1.0' });
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    const marks = Array.from(el.querySelectorAll('.m-install-mark')).map((m) => m.textContent);
    expect(marks).toEqual(['✓', '✓', '✓', '✓', '5', '6']);
  });

  it('Homebrew Channel present: opens it on the TV with the OMP repository', async () => {
    lg.answers['ssap://com.webos.applicationManager/listApps'] = apps({ id: 'org.webosbrew.hbchannel', version: '0.7.0' });
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    expect(el.textContent).toContain('есть Homebrew Channel');
    click(button(el, 'Открыть Homebrew Channel на ТВ'));
    await flush();
    expect(lg.launches()).toEqual([
      { id: 'org.webosbrew.hbchannel', params: { launchMode: 'addRepository', url: expect.stringContaining('apps.json') } },
    ]);
    expect(toast.value).toBe('Homebrew Channel открыт на телевизоре');
  });

  it('OMP present: version and «Обновить на ТВ» opens the update on the TV', async () => {
    lg.answers['ssap://com.webos.applicationManager/listApps'] = apps({ id: 'com.spacesarmat.torrplayer', version: '0.12.1' });
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    expect(el.textContent).toContain('Версия 0.12.1 — есть 0.13.1');
    expect(probed).toEqual([]);
    click(button(el, 'Обновить на ТВ'));
    await flush();
    expect(lg.launches()).toEqual([{ id: 'com.spacesarmat.torrplayer', params: { open: 'update' } }]);
  });

  it('webOS 3.x: not supported', async () => {
    lg.answers['ssap://com.webos.service.update/getCurrentSWInformation'] = { product_name: 'webOSTV 3.5' };
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    expect(el.textContent).toContain('webOS 3.5 · не поддерживается');
    expect(el.querySelectorAll('.m-install-step').length).toBe(0);
  });

  it('pairing declined: the error and a retry that connects again', async () => {
    lg.decline = true;
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    expect(el.textContent).toContain('Подключение отклонено на телевизоре');
    lg.decline = false;
    click(button(el, 'Подключиться снова'));
    await flush();
    expect(el.textContent).toContain('без root — ставим через режим разработчика');
  });

  it('the FAQ link opens that question', async () => {
    resetTo({ name: 'install', ip: LG_IP, kind: 'lg' });
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    click(button(el, 'Подробная инструкция'));
    expect(currentRoute.value).toEqual({ name: 'faq', q: FAQ_LG_DEVMODE });
    const faq = mount(<Faq q={FAQ_LG_DEVMODE} />);
    const open = faq.querySelector('.m-faq-item.open')!;
    expect(open.textContent).toContain(FAQ_LG_DEVMODE);
    expect(open.textContent).toContain('Developer Mode');
  });
});

describe('Install assistant — Android TV steps', () => {
  it('no OMP: the debugging steps and the arm64 note', async () => {
    const el = mount(<InstallAssistant />);
    await flush();
    act(() => render(null, el));
    const steps = mount(<InstallAssistant ip={ATV_IP} kind="atv" />);
    await flush();
    expect(steps.querySelector('.m-bar-title')!.textContent).toBe('Chromecast «Спальня»');
    expect(Array.from(steps.querySelectorAll('.m-install-step-title')).map((n) => n.textContent)).toEqual([
      'Режим разработчика',
      'Отладка по сети',
      'Установка',
    ]);
    expect(steps.textContent).toContain('Беспроводная отладка');
    expect(steps.textContent).toContain('arm64');
    expect(button(steps, 'Установить OMP')!.disabled).toBe(true);
  });

  it('OMP answering on the box: version and update hint without a pairing', async () => {
    mockFetch((url) => {
      if (url === 'http://192.168.1.66:8095/omp/info') return { body: JSON.stringify({ name: 'X', version: '0.12.0', paired: false }) };
      if (url.indexOf(ANDROID_UPDATE_URL) === 0) return { body: JSON.stringify({ version: '0.13.1', ipkUrl: 'https://x/a.apk', ipkHash: HASH }) };
      return { status: 404, body: '' };
    });
    const el = mount(<InstallAssistant ip="192.168.1.66" kind="atv" />);
    await flush();
    expect(el.textContent).toContain('Версия 0.12.0 — есть 0.13.1');
    click(button(el, 'Обновить на ТВ'));
    await flush();
    expect(el.textContent).toContain('Подключите телефон к этому телевизору кодом');
  });
});

describe('Install assistant — entry points', () => {
  it('Settings has «Установить OMP на телевизор»', () => {
    const el = mount(<Settings />);
    click(button(el, 'Установить OMP на телевизор'));
    expect(currentRoute.value).toEqual({ name: 'install' });
  });

  it('the TV screen offers the assistant when the connected LG has no OMP', async () => {
    setTvDiscoverer(async () => [{ ip: LG_IP, name: 'LG «Гостиная»' }]);
    setAtvDiscoverer(async () => []);
    resetTo({ name: 'settings' });
    navigate({ name: 'tv' });
    const el = mount(<Tv />);
    await flush();
    expect(el.textContent).not.toContain('На этом телевизоре нет OMP.');
    await act(async () => {
      await connectTv({ ip: LG_IP, name: 'LG «Гостиная»' });
    });
    await flush();
    expect(el.textContent).toContain('На этом телевизоре нет OMP.');
    click(button(el, 'Установить OMP'));
    expect(currentRoute.value).toEqual({ name: 'install', ip: LG_IP, kind: 'lg' });
  });

  it('the TV screen stays quiet when OMP is there', async () => {
    lg.answers['ssap://com.webos.applicationManager/listApps'] = apps({ id: 'com.spacesarmat.torrplayer', version: '0.13.1' });
    saveTv({ ip: LG_IP, name: 'LG «Гостиная»', clientKey: 'K' });
    setTvDiscoverer(async () => []);
    setAtvDiscoverer(async () => []);
    const el = mount(<Tv />);
    await act(async () => {
      await connectTv({ ip: LG_IP, name: 'LG «Гостиная»' });
    });
    await flush();
    expect(el.textContent).not.toContain('На этом телевизоре нет OMP.');
    click(button(el, 'Нет OMP на телевизоре? Помощник установки'));
    expect(currentRoute.value).toEqual({ name: 'install' });
  });
});

describe('Install assistant — the current TV', () => {
  const A = '192.168.1.50';

  async function connectA() {
    saveTv({ ip: A, name: 'Спальня', clientKey: 'K' });
    await act(async () => {
      await connectTv({ ip: A, name: 'Спальня', clientKey: 'K' });
    });
    expect(sessionIp.value).toBe(A);
  }

  it('asks before switching away from the connected TV; «Отмена» goes back', async () => {
    await connectA();
    resetTo({ name: 'install' });
    navigate({ name: 'install', ip: LG_IP, kind: 'lg' });
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg.textContent).toContain('Подключиться к «LG «Гостиная»»? Текущее подключение к «Спальня» будет закрыто.');
    expect(lg.connects).toEqual([A]);
    click(button(dlg as HTMLElement, 'Отмена'));
    expect(currentRoute.value).toEqual({ name: 'install' });
    expect(sessionIp.value).toBe(A);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('«Подключиться» inspects the TV without making it active; leaving gives the old TV back', async () => {
    await connectA();
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    click(button(document.querySelector('[role="dialog"]') as HTMLElement, 'Подключиться'));
    await flush();
    expect(el.textContent).toContain('без root — ставим через режим разработчика');
    expect(sessionIp.value).toBe(LG_IP);
    expect(activeTvIp.value).toBe(A);
    // a recheck does not ask again
    click(button(el, 'Проверить снова'));
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      render(null, el);
    });
    await flush();
    expect(lg.connects[lg.connects.length - 1]).toBe(A);
    expect(sessionIp.value).toBe(A);
    expect(tvState.value).toBe('connected');
    expect(activeTvIp.value).toBe(A);
  });

  it('with nothing connected: no question, the inspected TV is saved but not active, and is closed on leave', async () => {
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(tvs.value.map((t) => t.ip)).toEqual([LG_IP]);
    expect(activeTvIp.value).toBeNull();
    await act(async () => {
      render(null, el);
    });
    await flush();
    expect(sessionIp.value).toBeNull();
  });

  it('Android TV «Обновить на ТВ» asks too and keeps the active TV', async () => {
    const TOKEN = '0123456789abcdef0123456789abcdef';
    await connectA();
    saveTv({ ip: '192.168.1.66', name: 'Приставка', kind: 'atv', token: TOKEN });
    expect(activeTvIp.value).toBe(A);
    mockFetch((url) => {
      if (url === 'http://192.168.1.66:8095/omp/info') return { body: JSON.stringify({ name: 'X', version: '0.12.0', paired: true, foreground: true }) };
      if (url.indexOf(ANDROID_UPDATE_URL) === 0) return { body: JSON.stringify({ version: '0.13.1', ipkUrl: 'https://x/a.apk', ipkHash: HASH }) };
      return { body: '{"ok":true}' };
    });
    const el = mount(<InstallAssistant ip="192.168.1.66" kind="atv" />);
    await flush();
    click(button(el, 'Обновить на ТВ'));
    await flush();
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dlg.textContent).toContain('Текущее подключение к «Спальня» будет закрыто.');
    click(button(dlg, 'Подключиться'));
    await flush();
    expect(sessionIp.value).toBe('192.168.1.66');
    expect(activeTvIp.value).toBe(A);
    await act(async () => {
      render(null, el);
    });
    await flush();
    expect(sessionIp.value).toBe(A);
  });
});

describe('Install assistant — more', () => {
  it('leaving the list stops the native search', async () => {
    const el = mount(<InstallAssistant />);
    await flush();
    act(() => render(null, el));
    expect(stops).toBe(1);
  });

  it('manual Samsung: not supported yet', async () => {
    resetTo({ name: 'install' });
    const el = mount(<InstallAssistant />);
    await flush();
    click(button(el, 'Ввести IP вручную'));
    type(el.querySelector<HTMLInputElement>('#install-ip')!, '192.168.1.70');
    click(button(el, 'Samsung'));
    click(button(el, 'Показать шаги'));
    expect(currentRoute.value).toEqual({ name: 'install', ip: '192.168.1.70', kind: 'samsung' });
    const steps = mount(<InstallAssistant ip="192.168.1.70" kind="samsung" />);
    await flush();
    expect(steps.textContent).toContain('Samsung (Tizen) пока не поддерживается');
  });
});

/** Scripted phone installer: records requests, lets the test emit events and settle the install. */
function fakeInstaller() {
  const f = {
    reqs: [] as InstallRequest[],
    cancels: 0,
    reminders: [] as Array<{ tv: string; at: number | null; name?: string }>,
    scheduled: null as number | null,
    emit: (_e: InstallEvent) => {},
    resolve: (_r: InstallResult) => {},
    reject: (_code: string) => {},
  };
  const n: InstallerNative = {
    available: true,
    start(req, onEvent) {
      f.reqs.push(req);
      f.emit = onEvent;
      return new Promise<InstallResult>((res, rej) => {
        f.resolve = res;
        f.reject = (code) => rej(new InstallError(code));
      });
    },
    async cancel() {
      f.cancels++;
    },
    async reminder(tv, at, name) {
      f.reminders.push(name === undefined ? { tv, at } : { tv, at, name });
    },
    async reminderState(tv) {
      return tv === LG_IP ? f.scheduled : null;
    },
  };
  setInstallerNative(n);
  return f;
}

function check(box: HTMLInputElement, on: boolean) {
  box.checked = on;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Install assistant — install from the phone', () => {
  it('LG: needs the code, sends it once, shows progress and the result with Homebrew Channel', async () => {
    clearLog();
    const inst = fakeInstaller();
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    const install = button(el, 'Установить OMP и Homebrew Channel')!;
    expect(install.disabled).toBe(false);
    click(install);
    expect(el.querySelector('[role="alert"]')!.textContent).toBe('Введите код (Passphrase) с экрана Developer Mode');
    expect(inst.reqs).toEqual([]);
    type(el.querySelector<HTMLInputElement>('#install-pass')!, ' a1b2c3 ');
    click(button(el, 'Установить OMP и Homebrew Channel'));
    expect(inst.reqs).toEqual([{ method: 'lg-devmode', ip: LG_IP, passphrase: 'a1b2c3', withHbc: true }]);
    expect(el.querySelector('#install-pass')).toBeNull();
    expect(el.textContent).toContain('Проверяю код на телевизоре');
    act(() => inst.emit({ phase: 'download', item: 'omp', percent: 50, version: '0.14.0' }));
    expect(el.textContent).toContain('Устанавливаю OMP 0.14.0');
    expect(el.textContent).toContain('Скачиваю OMP с GitHub · 50%');
    act(() => inst.emit({ phase: 'upload', item: 'omp', percent: 40, version: '0.14.0' }));
    expect(el.textContent).toContain('Скачано с GitHub, проверено · передаю на телевизор');
    const bar = el.querySelector('[role="progressbar"]')!;
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(30);
    expect(el.textContent).not.toContain('Разрешить отладку');
    await act(async () => inst.resolve({ version: '0.14.0', hbcVersion: '0.7.3' }));
    await flush();
    expect(el.querySelector('[data-install="done"]')!.textContent).toContain('OMP 0.14.0 установлен');
    expect(el.textContent).toContain('Homebrew Channel 0.7.3 установлен');
    const logs = JSON.stringify(logEntries());
    expect(logs).toContain('Установка с телефона: LG, режим разработчика');
    expect(logs).toContain('OMP установлен с телефона');
    expect(logs).not.toContain(LG_IP);
    expect(logs.toLowerCase()).not.toContain('a1b2c3');
    expect(localStorage.getItem('tsp.log') || '').not.toContain('a1b2c3');
  });

  it('LG: the reminder is scheduled 3 days before the 1000 hours end, only with notifications allowed', async () => {
    const inst = fakeInstaller();
    const perm = vi.spyOn(monitorNative, 'requestNotifyPermission').mockResolvedValue('granted');
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    type(el.querySelector<HTMLInputElement>('#install-pass')!, 'A1B2C3');
    click(button(el, 'Установить OMP и Homebrew Channel'));
    const before = Date.now();
    await act(async () => inst.resolve({ version: '0.14.0', hbcError: 'checksum' }));
    await flush();
    expect(el.textContent).toContain('Homebrew Channel не установлен: файл не прошёл проверку');
    const box = el.querySelector<HTMLInputElement>('[data-reminder]')!;
    expect(box.checked).toBe(false);
    await act(async () => check(box, true));
    await flush();
    expect(perm).toHaveBeenCalled();
    expect(inst.reminders.length).toBe(1);
    expect(inst.reminders[0].tv).toBe(LG_IP);
    expect(inst.reminders[0].name).toBe('LG «Гостиная»');
    const at = inst.reminders[0].at!;
    expect(at - before).toBeGreaterThanOrEqual(928 * 3600e3 - 5000);
    expect(at - before).toBeLessThanOrEqual(928 * 3600e3 + 5000);
    expect(el.textContent).toContain('Напомню через 38 дней');
    await act(async () => check(box, false));
    await flush();
    expect(inst.reminders[1]).toEqual({ tv: LG_IP, at: null });
    // notifications refused: no reminder
    perm.mockResolvedValue('denied');
    await act(async () => check(box, true));
    await flush();
    expect(inst.reminders.length).toBe(2);
    expect(box.checked).toBe(false);
    expect(el.textContent).toContain('напоминание не придёт');
  });

  it('LG: a reminder already scheduled for this TV shows as checked; the Key Server hint is shown', async () => {
    const inst = fakeInstaller();
    inst.scheduled = new Date(2026, 10, 12, 10, 0).getTime();
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    type(el.querySelector<HTMLInputElement>('#install-pass')!, 'A1B2C3');
    click(button(el, 'Установить OMP и Homebrew Channel'));
    await act(async () => inst.resolve({ version: '0.14.0' }));
    await flush();
    expect(el.querySelector<HTMLInputElement>('[data-reminder]')!.checked).toBe(true);
    expect(el.textContent).toContain('Напоминание уже включено: 12 ноября');
    expect(el.textContent).toContain('Выключите Key Server в Developer Mode');
    expect(inst.reminders).toEqual([]);
  });

  it('LG: without Homebrew Channel; a wrong code shows the next step and «Повторить» returns to the form', async () => {
    const inst = fakeInstaller();
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    const hbc = el.querySelector<HTMLInputElement>('.m-install-form input[type="checkbox"]')!;
    act(() => check(hbc, false));
    type(el.querySelector<HTMLInputElement>('#install-pass')!, 'ZZZZZZ');
    click(button(el, 'Установить OMP'));
    expect(inst.reqs[0].withHbc).toBe(false);
    await act(async () => inst.reject('wrong-passphrase'));
    await flush();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Код не подошёл');
    expect(JSON.stringify(logEntries())).toContain('Установка с телефона не удалась: wrong-passphrase');
    click(button(el, 'Повторить'));
    expect(el.querySelector<HTMLInputElement>('#install-pass')!.value).toBe('');
  });

  it('cancel stops the install; leaving the screen cancels too', async () => {
    const inst = fakeInstaller();
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    type(el.querySelector<HTMLInputElement>('#install-pass')!, 'A1B2C3');
    click(button(el, 'Установить OMP и Homebrew Channel'));
    click(button(el, 'Отмена'));
    expect(inst.cancels).toBe(1);
    await act(async () => inst.reject('cancelled'));
    await flush();
    expect(el.textContent).toContain('Установка отменена.');
    click(button(el, 'Повторить'));
    type(el.querySelector<HTMLInputElement>('#install-pass')!, 'A1B2C3');
    click(button(el, 'Установить OMP и Homebrew Channel'));
    act(() => render(null, el));
    expect(inst.cancels).toBe(2);
  });

  it('Android TV: no fields, the «Разрешить отладку?» hint, a closed port offers the APK and the FAQ', async () => {
    const inst = fakeInstaller();
    const el = mount(<InstallAssistant ip={ATV_IP} kind="atv" />);
    await flush();
    expect(el.querySelector('#install-pass')).toBeNull();
    click(button(el, 'Установить OMP'));
    expect(inst.reqs).toEqual([{ method: 'atv-adb', ip: ATV_IP }]);
    expect(el.textContent).toContain('Подключаюсь к телевизору');
    expect(el.textContent).toContain('Если на ТВ появится «Разрешить отладку?» — нажмите «Разрешить».');
    await act(async () => inst.reject('adb-closed'));
    await flush();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('порту 5555');
    expect(button(el, 'Скачать APK')).toBeDefined();
    click(button(el, 'Как установить через компьютер'));
    expect(currentRoute.value).toEqual({ name: 'faq', q: 'Как установить OMP на Android TV через adb?' });
  });

  it('Android TV: an unreachable box says to check the IP, not to press «Разрешить»', async () => {
    const inst = fakeInstaller();
    const el = mount(<InstallAssistant ip={ATV_IP} kind="atv" />);
    await flush();
    click(button(el, 'Установить OMP'));
    await act(async () => inst.reject('unreachable'));
    await flush();
    const alert = el.querySelector('[role="alert"]')!.textContent!;
    expect(alert).toContain('Телевизор не отвечает — проверьте IP и что он включён');
    expect(alert).not.toContain('Разрешить');
    expect(button(el, 'Скачать APK')).toBeDefined();
  });

  it('Android TV: success, with the TorrServer note for a 32-bit box', async () => {
    const inst = fakeInstaller();
    const el = mount(<InstallAssistant ip={ATV_IP} kind="atv" />);
    await flush();
    click(button(el, 'Установить OMP'));
    act(() => inst.emit({ phase: 'install', item: 'omp', version: '0.14.0' }));
    expect(el.textContent).toContain('Телевизор устанавливает OMP');
    await act(async () => inst.resolve({ version: '0.14.0', sdkInt: 28, abi: 'armeabi-v7a' }));
    await flush();
    expect(el.textContent).toContain('OMP 0.14.0 установлен');
    expect(el.textContent).toContain('не 64-битная (armeabi-v7a)');
    expect(el.querySelector('[data-reminder]')).toBeNull();
  });
});
