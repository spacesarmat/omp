import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SettingsScreen } from '../../src/screens/Settings';
import { settings, resetSettings } from '../../src/store/settings';

const w = window as unknown as { Capacitor?: unknown };

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(h(SettingsScreen, {}), host);
  return host;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
afterEach(() => {
  delete w.Capacitor;
  resetSettings();
  Array.from(document.body.children).forEach((c) => render(null, c));
  document.body.innerHTML = '';
});

describe('SettingsScreen Homebrew button', () => {
  it('webOS: offers adding the OMP repository to Homebrew Channel', () => {
    const host = mount();
    expect(host.textContent).toContain('Добавить репозиторий OMP в Homebrew Channel');
    expect(host.textContent).toContain('Обновление');
  });
  it('Android TV: no Homebrew button, the update screen stays', () => {
    w.Capacitor = { getPlatform: () => 'android' };
    const host = mount();
    expect(host.textContent).not.toContain('Homebrew');
    expect(host.textContent).toContain('Обновление');
  });
});

describe('SettingsScreen «Плеер»', () => {
  it('webOS: no player choice', () => {
    const host = mount();
    expect(host.textContent).not.toContain('Чем показывать видео на этом телевизоре.');
  });
  it('Android TV: Авто / Встроенный / VLC with texts; a press stores the choice', () => {
    w.Capacitor = { getPlatform: () => 'android' };
    const host = mount();
    expect(host.textContent).toContain('Чем показывать видео на этом телевизоре.');
    expect(host.textContent).toContain('Для отдельной раздачи плеер меняется в меню плеера — «Сменить плеер».');
    const radios = Array.from(host.querySelectorAll('[role="radio"]')) as HTMLElement[];
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Авто', 'Встроенный', 'VLC']);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(radios[2].textContent).toContain('Почти все форматы и субтитры ASS со стилями; чуть дольше открывает файл');
    radios[2].click();
    expect(settings.value.playerEngine).toBe('vlc');
    expect(JSON.parse(localStorage.getItem('tsp.settings') || '{}').playerEngine).toBe('vlc');
  });
  it('Android TV without libVLC: VLC is disabled with the reason', async () => {
    w.Capacitor = {
      getPlatform: () => 'android',
      Plugins: { OmpNative: { localIpv4: () => Promise.resolve({}), vlcAvailable: () => Promise.resolve({ available: false }) } },
    };
    const host = mount();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
    const vlc = host.querySelector('[aria-label="VLC"]') as HTMLElement;
    expect(vlc.className).toContain('disabled');
    expect(vlc.textContent).toContain('VLC недоступен на этом устройстве');
    vlc.click();
    expect(settings.value.playerEngine).toBe('auto');
  });
});

describe('SettingsScreen «Плеер для видео»', () => {
  const cap = (pkg: string | null) => {
    w.Capacitor = {
      getPlatform: () => 'android',
      Plugins: { OmpNative: { localIpv4: () => Promise.resolve({}), vlcAvailable: () => Promise.resolve({ available: true }), player2160: () => Promise.resolve({ package: pkg }) } },
    };
  };
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 20)); };
  // the 2160 Player check is async: wait for its result (a loaded CI runner can take longer than a fixed pause)
  const until = async (ok: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  };
  const rowOf = (host: HTMLElement) => Array.from(host.querySelectorAll('.choice-row')).find((e) => (e.textContent || '').indexOf('Плеер для видео') >= 0) as HTMLElement;
  it('webOS: no row', () => {
    const host = mount();
    expect(host.textContent).not.toContain('Плеер для видео');
  });
  it('not installed: marked «не установлен» and not selectable', async () => {
    cap(null);
    const host = mount();
    await until(() => (host.textContent || '').indexOf('не установлен') >= 0);
    expect(host.textContent).toContain('не установлен');
    expect(host.querySelector('svg.qr')).not.toBeNull();
    rowOf(host).click();
    expect(settings.value.videoPlayer).toBe('builtin');
  });
  it('installed: a press selects 2160 Player', async () => {
    cap('tv.p2160.player');
    const host = mount();
    await settle();
    expect(host.textContent).not.toContain('не установлен');
    // selectable once the check has answered
    await until(() => {
      rowOf(host).click();
      return settings.value.videoPlayer === 'p2160';
    });
    expect(settings.value.videoPlayer).toBe('p2160');
  });
});
