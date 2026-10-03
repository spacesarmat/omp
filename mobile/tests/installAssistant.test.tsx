import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { mockFetch } from '../../tests/helpers/fetchMock';
import { InstallAssistant, setInstaller } from '../src/screens/InstallAssistant';
import { Settings } from '../src/screens/Settings';
import { Tv, setTvDiscoverer, setAtvDiscoverer } from '../src/screens/Tv';
import { Faq } from '../src/screens/Faq';
import { setInstallNative, type InstallNative } from '../src/install/devices';
import { setTransport, disconnectTv, connectTv, type TvTransport } from '../src/tv/tvClient';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
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
  decline = false;
  answers: Record<string, any> = {};
  private cbs = new Set<(m: any) => void>();
  async tvConnect(_ip: string, register: any) {
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
  setInstaller(null);
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
  it('pairs, reads the TV and shows the Developer Mode path; «Установить» waits for the installer', async () => {
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
    expect(el.querySelector('[data-install-soon]')).not.toBeNull();
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

  it('with an installer (Task 7) «Установить» hands over the plan and facts', async () => {
    const got: any[] = [];
    setInstaller((plan, facts) => got.push({ plan, facts }));
    const el = mount(<InstallAssistant ip={LG_IP} kind="lg" />);
    await flush();
    const install = button(el, 'Установить OMP и Homebrew Channel')!;
    expect(install.disabled).toBe(false);
    click(install);
    expect(got[0].plan.install).toEqual({ method: 'lg-devmode', ip: LG_IP, withHbc: true });
    expect(got[0].facts.productName).toBe('webOSTV 6.0');
    expect(JSON.stringify(got[0].facts)).not.toContain('aa:bb:cc');
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
