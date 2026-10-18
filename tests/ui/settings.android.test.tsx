import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SettingsScreen } from '../../src/screens/Settings';
import { settings, resetSettings, updateSettings } from '../../src/store/settings';
import { applyLanguageSetting } from '../../src/i18n';
import { DialogHost } from '../../src/ui/dialog';
import { ToastHost } from '../../src/ui/toast';

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
  applyLanguageSetting('ru');
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
    expect(host.textContent).not.toContain('Всегда FFmpeg');
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
  it('Android TV: «Всегда FFmpeg» is off, explained, and a press stores it', async () => {
    w.Capacitor = { getPlatform: () => 'android' };
    const host = mount();
    expect(host.textContent).toContain('Всегда FFmpeg');
    expect(host.textContent).toContain('зелёный экран');
    expect(host.textContent).toContain('на ресивер не уходит как есть');
    const rowOf = () => Array.from(host.querySelectorAll('.choice-row')).find((e) => (e.textContent || '').indexOf('Всегда FFmpeg') >= 0) as HTMLElement;
    expect(rowOf().textContent).toContain('Выкл');
    expect(settings.value.alwaysFfmpeg).toBe(false);
    await act(() => { rowOf().click(); });
    expect(settings.value.alwaysFfmpeg).toBe(true);
    expect(JSON.parse(localStorage.getItem('tsp.settings') || '{}').alwaysFfmpeg).toBe(true);
    expect(rowOf().textContent).toContain('Вкл');
    await act(() => { rowOf().click(); });
    expect(settings.value.alwaysFfmpeg).toBe(false);
    expect(JSON.parse(localStorage.getItem('tsp.settings') || '{}').alwaysFfmpeg).toBe(false);
    expect(rowOf().textContent).toContain('Выкл');
  });
  it('Android TV in English: the row and the hint have no Cyrillic', () => {
    applyLanguageSetting('en');
    w.Capacitor = { getPlatform: () => 'android' };
    const host = mount();
    expect(host.textContent).toContain('Always use FFmpeg');
    const notes = Array.from(host.querySelectorAll('.engine-note')).map((e) => e.textContent || '').join('\n');
    expect(notes).toContain('green screen');
    expect(notes).toContain('not passed through to a receiver');
    expect(notes).not.toMatch(/[А-Яа-яЁё]/);
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

describe('SettingsScreen «Открывать при включении»', () => {
  const rowOf = (host: HTMLElement, label: string) =>
    Array.from(host.querySelectorAll('.choice-row')).find((e) => (e.textContent || '').indexOf(label) >= 0) as HTMLElement;
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };

  it('webOS: the switch is absent', () => {
    const host = mount();
    expect(host.textContent).not.toContain('Открывать при включении');
    expect(host.textContent).not.toContain('Open on startup');
  });

  it('Android TV: on by default, with the hint, and a press stores off', async () => {
    w.Capacitor = { getPlatform: () => 'android' };
    const host = mount();
    const row = rowOf(host, 'Открывать при включении');
    expect(row.textContent).toContain('Вкл');
    expect(host.textContent).toContain('сразу после включения приставки');
    expect(settings.value.openOnStartup).toBe(true);
    await act(() => { row.click(); });
    expect(settings.value.openOnStartup).toBe(false);
    expect(JSON.parse(localStorage.getItem('tsp.settings') || '{}').openOnStartup).toBe(false);
    expect(row.textContent).toContain('Выкл');
  });

  it('Android TV in English: the row and the hint have no Cyrillic', () => {
    applyLanguageSetting('en');
    w.Capacitor = { getPlatform: () => 'android' };
    const host = mount();
    const row = rowOf(host, 'Open on startup');
    expect(row.textContent).toContain('On');
    const notes = Array.from(host.querySelectorAll('.engine-note')).map((e) => e.textContent || '').join('\n');
    expect(notes).toContain('right after the TV box turns on');
    expect(row.textContent + notes).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('a blocked launch shows the allow button only while the switch is on', async () => {
    w.Capacitor = {
      getPlatform: () => 'android',
      Plugins: {
        OmpNative: {
          localIpv4: () => Promise.resolve({}),
          openOnStartupState: () => Promise.resolve({ launchBlocked: true, canDrawOverlays: false, needsOverlay: false }),
          setOpenOnStartup: () => Promise.resolve({ launchBlocked: true, canDrawOverlays: false, needsOverlay: false }),
        },
      },
    };
    const host = mount();
    for (let i = 0; i < 20 && (host.textContent || '').indexOf('не дала открыть') < 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(host.textContent).toContain('Система не дала открыть OMP при включении.');
    expect(host.textContent).toContain('Разрешить показ поверх окон');
    const row = rowOf(host, 'Открывать при включении');
    await act(() => { row.click(); });
    await flush();
    expect(settings.value.openOnStartup).toBe(false);
    expect(host.textContent).not.toContain('Разрешить показ поверх окон');
  });

  it('overlay already granted: no blocked hint', async () => {
    w.Capacitor = {
      getPlatform: () => 'android',
      Plugins: {
        OmpNative: {
          localIpv4: () => Promise.resolve({}),
          openOnStartupState: () => Promise.resolve({ launchBlocked: true, canDrawOverlays: true, needsOverlay: false }),
        },
      },
    };
    const host = mount();
    await flush();
    await new Promise((r) => setTimeout(r, 20));
    expect(host.textContent).not.toContain('не дала открыть');
    expect(host.textContent).not.toContain('Разрешить показ поверх окон');
  });

  it('turning the switch on after a blocked launch asks, then opens the system screen', async () => {
    updateSettings({ openOnStartup: false });
    let opened = 0;
    w.Capacitor = {
      getPlatform: () => 'android',
      Plugins: {
        OmpNative: {
          localIpv4: () => Promise.resolve({}),
          openOnStartupState: () => Promise.resolve({ launchBlocked: true, canDrawOverlays: false, needsOverlay: false }),
          setOpenOnStartup: (o: { enabled: boolean }) => Promise.resolve({
            enabled: o.enabled,
            launchBlocked: true,
            canDrawOverlays: false,
            needsOverlay: o.enabled === true,
          }),
          requestOpenOnStartupOverlay: () => { opened += 1; return Promise.resolve({ opened: true }); },
        },
      },
    };
    const dialogs = document.createElement('div');
    document.body.appendChild(dialogs);
    render(h(DialogHost, {}), dialogs);
    const host = mount();
    const row = rowOf(host, 'Открывать при включении');
    expect(row.textContent).toContain('Выкл');
    await act(() => { row.click(); });
    await flush();
    expect(document.body.textContent).toContain('Разрешите показ поверх других окон');
    expect(opened).toBe(0);
    const allow = Array.from(document.querySelectorAll('.dialog-option')).find((e) => (e.textContent || '').indexOf('Разрешить показ поверх окон') >= 0) as HTMLElement;
    await act(() => { allow.click(); });
    await flush();
    expect(opened).toBe(1);
    expect(settings.value.openOnStartup).toBe(true);
  });

  it('cancelling the prompt leaves the switch on and does not open system settings', async () => {
    updateSettings({ openOnStartup: false });
    let opened = 0;
    w.Capacitor = {
      getPlatform: () => 'android',
      Plugins: {
        OmpNative: {
          localIpv4: () => Promise.resolve({}),
          openOnStartupState: () => Promise.resolve({ launchBlocked: false, canDrawOverlays: false }),
          setOpenOnStartup: (o: { enabled: boolean }) => Promise.resolve({
            launchBlocked: true,
            canDrawOverlays: false,
            needsOverlay: o.enabled === true,
          }),
          requestOpenOnStartupOverlay: () => { opened += 1; return Promise.resolve({ opened: true }); },
        },
      },
    };
    const dialogs = document.createElement('div');
    document.body.appendChild(dialogs);
    render(h(DialogHost, {}), dialogs);
    const host = mount();
    await act(() => { rowOf(host, 'Открывать при включении').click(); });
    await flush();
    const cancel = Array.from(document.querySelectorAll('.dialog-option')).find((e) => (e.textContent || '') === 'Отмена') as HTMLElement;
    await act(() => { cancel.click(); });
    await flush();
    expect(opened).toBe(0);
    expect(settings.value.openOnStartup).toBe(true);
  });

  it('a missing system screen shows an error and keeps the switch on', async () => {
    updateSettings({ openOnStartup: false });
    w.Capacitor = {
      getPlatform: () => 'android',
      Plugins: {
        OmpNative: {
          localIpv4: () => Promise.resolve({}),
          openOnStartupState: () => Promise.resolve({ launchBlocked: true, canDrawOverlays: false }),
          setOpenOnStartup: (o: { enabled: boolean }) => Promise.resolve({
            launchBlocked: true,
            canDrawOverlays: false,
            needsOverlay: o.enabled === true,
          }),
          requestOpenOnStartupOverlay: () => Promise.resolve({ opened: false }),
        },
      },
    };
    const dialogs = document.createElement('div');
    document.body.appendChild(dialogs);
    render(h(DialogHost, {}), dialogs);
    const toasts = document.createElement('div');
    document.body.appendChild(toasts);
    render(h(ToastHost, {}), toasts);
    const host = mount();
    await act(() => { rowOf(host, 'Открывать при включении').click(); });
    await flush();
    const allow = Array.from(document.querySelectorAll('.dialog-option')).find((e) => (e.textContent || '').indexOf('Разрешить показ поверх окон') >= 0) as HTMLElement;
    await act(() => { allow.click(); });
    await flush();
    expect(toasts.textContent).toContain('Не удалось открыть настройки системы.');
    expect(settings.value.openOnStartup).toBe(true);
  });
});
