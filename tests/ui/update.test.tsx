import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { Qr } from '../../src/ui/Qr';
import { UpdateScreen, apkJob } from '../../src/screens/Update';
import { latestUpdate } from '../../src/store/updates';
import { whatsNew, closeWhatsNew } from '../../src/store/whatsNew';

const info = {
  version: '9.9.9',
  ipkUrl: 'https://github.com/spacesarmat/omp/releases/download/v9.9.9/a.ipk',
  ipkHash: 'c'.repeat(64),
  ipkSize: 1,
  notes: ['Первое', 'Второе'],
  releaseUrl: 'https://github.com/spacesarmat/omp/releases/tag/v9.9.9',
};

function bridge(root: boolean, hb: 'installed' | 'missing') {
  (window as any).PalmServiceBridge = function (this: any) {
    this.call = (uri: string) => {
      let reply: object = { returnValue: true };
      if (uri.indexOf('checkRoot') >= 0) reply = { returnValue: root };
      if (uri.indexOf('getAppInfo') >= 0) reply = hb === 'installed' ? { returnValue: true, appInfo: {} } : { returnValue: false, errorText: 'app not exist' };
      setTimeout(() => this.onservicecallback(JSON.stringify(reply)), 0);
    };
  };
}

interface Fake { emit(m: object): void; cancels: number }
function streamBridge(opts: { root: boolean; hb: 'installed' | 'missing' | 'denied' }): Fake {
  const fake: Fake = { emit: () => undefined, cancels: 0 };
  (window as any).PalmServiceBridge = function (this: any) {
    this.cancel = () => { fake.cancels++; };
    this.call = (uri: string) => {
      if (uri.indexOf('install') >= 0 && uri.indexOf('checkRoot') < 0) {
        fake.emit = (m: object) => this.onservicecallback(JSON.stringify(m));
        return;
      }
      let reply: object = { returnValue: true };
      if (uri.indexOf('checkRoot') >= 0) reply = { returnValue: opts.root };
      if (uri.indexOf('getAppInfo') >= 0) {
        reply = opts.hb === 'installed' ? { returnValue: true, appInfo: {} }
          : opts.hb === 'missing' ? { returnValue: false, errorText: 'app not exist' }
          : { returnValue: false, errorText: 'Denied method call' };
      }
      setTimeout(() => this.onservicecallback(JSON.stringify(reply)), 0);
    };
  };
  return fake;
}

async function until(cond: () => boolean, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function pressInstall(host: HTMLElement) {
  const b = Array.from(host.querySelectorAll('.button')).find((x) => /Установить$|Повторить/.test(x.textContent || '')) as HTMLElement;
  b.click();
}

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(h(UpdateScreen, {}), host);
  return host;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => { latestUpdate.value = info; });
afterEach(() => { delete (window as any).PalmServiceBridge; document.body.innerHTML = ''; });

describe('UpdateScreen', () => {
  it('«Что нового» button opens the changelog list', async () => {
    bridge(false, 'installed');
    const host = await mount();
    const b = Array.from(host.querySelectorAll('.button')).find((x) => x.textContent === 'Что нового') as HTMLElement;
    expect(b).toBeTruthy();
    b.click();
    expect(whatsNew.value!.title).toBe('Что нового');
    expect(whatsNew.value!.entries.length).toBeGreaterThan(0);
    closeWhatsNew();
  });
  it('without root: no one-click install, Homebrew and computer blocks with QR', async () => {
    bridge(false, 'installed');
    const host = await mount();
    await until(() => host.textContent!.indexOf('Открыть Homebrew Channel') >= 0);
    await tick();
    await tick();
    expect(host.textContent).toContain('доступна 9.9.9');
    expect(host.textContent).toContain('Первое');
    expect(host.textContent).not.toContain('Установить сейчас');
    expect(host.textContent).toContain('Открыть Homebrew Channel');
    expect(host.textContent).toContain('Добавить репозиторий OMP');
    expect(host.querySelectorAll('svg.qr')).toHaveLength(1);
  });
  it('with root: shows one-click install', async () => {
    bridge(true, 'installed');
    const host = await mount();
    await until(() => host.textContent!.indexOf('Установить сейчас') >= 0);
    expect(host.textContent).toContain('Установить сейчас');
    expect(Array.from(host.querySelectorAll('.button')).some((b) => b.textContent === 'Установить')).toBe(true);
  });
  it('without Homebrew Channel: explains and shows a QR to webosbrew.org', async () => {
    bridge(false, 'missing');
    const host = await mount();
    await until(() => host.textContent!.indexOf('Homebrew Channel не установлен') >= 0);
    expect(host.textContent).toContain('Homebrew Channel не установлен');
    expect(host.textContent).not.toContain('Открыть Homebrew Channel');
    expect(host.querySelectorAll('svg.qr')).toHaveLength(2);
  });
  it('without a known update offers a manual check', async () => {
    latestUpdate.value = null;
    bridge(false, 'installed');
    const host = await mount();
    await until(() => host.textContent!.indexOf('Проверить обновления') >= 0);
    expect(host.textContent).toContain('Проверить обновления');
    expect(host.textContent).not.toContain('доступна');
  });

  it('install flow: progress, verify, done and cancel on done', async () => {
    const fake = streamBridge({ root: true, hb: 'installed' });
    const host = await mount();
    await until(() => host.textContent!.indexOf('Установить сейчас') >= 0);
    pressInstall(host);
    await until(() => host.textContent!.indexOf('Скачивание…') >= 0);
    fake.emit({ returnValue: true, progress: 42 });
    await until(() => host.textContent!.indexOf('Скачивание… 42%') >= 0);
    const fill = host.querySelector('.progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('42%');
    fake.emit({ returnValue: true, statusText: 'Verifying' });
    await until(() => host.textContent!.indexOf('Проверка…') >= 0);
    expect(host.querySelector('.progress')).toBeNull();
    expect(fake.cancels).toBe(0);
    fake.emit({ returnValue: true, finished: true });
    await until(() => host.textContent!.indexOf('Готово. Откройте OMP заново') >= 0);
    await tick();
    expect(fake.cancels).toBe(1);
  });
  it('install error: Russian banner, retry label, subscription cancelled', async () => {
    const fake = streamBridge({ root: true, hb: 'installed' });
    const host = await mount();
    await until(() => host.textContent!.indexOf('Установить сейчас') >= 0);
    pressInstall(host);
    await until(() => host.textContent!.indexOf('Скачивание…') >= 0);
    fake.emit({ returnValue: false, errorText: 'Hash mismatch' });
    await until(() => host.textContent!.indexOf('Не удалось установить: Hash mismatch') >= 0);
    expect(host.querySelector('.banner-error')).not.toBeNull();
    expect(Array.from(host.querySelectorAll('.button')).some((b) => b.textContent === 'Повторить')).toBe(true);
    expect(fake.cancels).toBe(1);
  });
  it('unknown Homebrew presence: caveat and both buttons', async () => {
    streamBridge({ root: false, hb: 'denied' });
    const host = await mount();
    await until(() => host.textContent!.indexOf('Если Homebrew Channel установлен:') >= 0);
    expect(host.textContent).toContain('Открыть Homebrew Channel');
    expect(host.textContent).toContain('Добавить репозиторий OMP');
    expect(host.textContent).not.toContain('не установлен');
  });
  it('computer QR encodes info.releaseUrl', async () => {
    latestUpdate.value = { ...info, releaseUrl: 'https://example.com/distinct/release/page' };
    streamBridge({ root: false, hb: 'installed' });
    const host = await mount();
    await until(() => host.querySelectorAll('svg.qr').length === 1);
    const ref = document.createElement('div');
    render(h(Qr, { text: 'https://example.com/distinct/release/page', size: 200 }), ref);
    const other = document.createElement('div');
    render(h(Qr, { text: info.releaseUrl, size: 200 }), other);
    const d = (e: HTMLElement) => e.querySelector('path:last-of-type')!.getAttribute('d');
    expect(d(host)).toBe(d(ref));
    expect(d(host)).not.toBe(d(other));
  });
});

describe('UpdateScreen on Android TV', () => {
  const w = window as unknown as { Capacitor?: unknown };
  let lunaCalls = 0;
  let calls: { method: string; o: any }[] = [];
  let settle: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  let progress: ((d: any) => void) | null = null;
  let removed = 0;

  beforeEach(() => {
    lunaCalls = 0;
    calls = [];
    settle = null;
    progress = null;
    removed = 0;
    apkJob.value = null;
    (window as any).PalmServiceBridge = function (this: any) { this.call = () => { lunaCalls++; }; };
    w.Capacitor = {
      getPlatform: () => 'android',
      Plugins: {},
      nativePromise: (_p: string, method: string, o: any) => {
        calls.push({ method, o });
        return new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
      },
      addListener: (_p: string, _e: string, cb: (d: any) => void) => {
        progress = cb;
        return { remove: () => { removed++; } };
      },
    };
  });
  afterEach(() => { delete w.Capacitor; });

  const installButton = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('.button')).find((x) => /Скачать и установить|Повторить|Установить снова/.test(x.textContent || '')) as HTMLElement;

  it('offers only the APK download, no Homebrew/computer methods and no luna calls', async () => {
    const host = await mount();
    await tick();
    expect(host.textContent).toContain('доступна 9.9.9');
    expect(host.textContent).toContain('Скачать и установить');
    expect(host.textContent).not.toContain('Homebrew');
    expect(host.textContent).not.toContain('С компьютера');
    expect(host.textContent).not.toContain('.ipk');
    expect(host.querySelectorAll('svg.qr')).toHaveLength(0);
    expect(lunaCalls).toBe(0);
  });

  it('download progress, then the system installer prompt', async () => {
    const host = await mount();
    installButton(host).click();
    await until(() => calls.length === 1);
    expect(calls[0]).toEqual({ method: 'downloadAndInstallApk', o: { url: info.ipkUrl, sha256: info.ipkHash } });
    expect(host.textContent).toContain('Скачивание…');
    progress!({ percent: 37 });
    await until(() => host.textContent!.indexOf('Скачивание… 37%') >= 0);
    expect((host.querySelector('.progress-fill') as HTMLElement).style.width).toBe('37%');
    settle!.resolve();
    await until(() => host.textContent!.indexOf('Подтвердите установку в открывшемся окне Android') >= 0);
    expect(host.querySelector('.progress')).toBeNull();
    expect(removed).toBe(1);
    expect(installButton(host).textContent).toBe('Установить снова');
    expect(installButton(host).classList.contains('disabled')).toBe(false);
  });

  it('returning to the screen during a download: «Обновление уже скачивается…», no enabled button', async () => {
    let host = await mount();
    installButton(host).click();
    await until(() => calls.length === 1);
    render(null, host);
    document.body.innerHTML = '';
    host = await mount();
    await tick();
    expect(host.textContent).toContain('Обновление уже скачивается…');
    expect(installButton(host).classList.contains('disabled')).toBe(true);
    installButton(host).click();
    await tick();
    expect(calls).toHaveLength(1);
    progress!({ percent: 55 });
    await until(() => host.textContent!.indexOf('Скачивание… 55%') >= 0);
    settle!.resolve();
    await until(() => host.textContent!.indexOf('Подтвердите установку') >= 0);
  });

  it('error: Russian banner from the native side and a retry', async () => {
    const host = await mount();
    installButton(host).click();
    await until(() => calls.length === 1);
    settle!.reject({ message: 'Разрешите установку из OMP и повторите установку' });
    await until(() => !!host.querySelector('.banner-error'));
    expect(host.querySelector('.banner-error')!.textContent).toBe('Разрешите установку из OMP и повторите установку');
    expect(installButton(host).textContent).toBe('Повторить');
    installButton(host).click();
    await until(() => calls.length === 2);
    expect(host.querySelector('.banner-error')).toBeNull();
  });
});
