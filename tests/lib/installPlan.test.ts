import { describe, it, expect } from 'vitest';
import {
  installPlan,
  parseWebOs,
  lgModelYear,
  androidLabel,
  isArm64,
  LG_HBC_APP_ID,
  LG_OMP_APP_ID,
  LG_DEVMODE_APP_ID,
  LG_SSH_PORT,
  LG_KEY_SERVER_PORT,
  ROOT_CHECK_URL,
  FAQ_LG_DEVMODE,
  FAQ_SAMSUNG,
  type LgFacts,
  type AtvFacts,
} from '../../src/lib/installPlan';
import { resolveFaqLink } from '../../mobile/src/faq';

const lg = (o: Partial<LgFacts> = {}): LgFacts => ({
  kind: 'lg',
  name: 'LG «Гостиная»',
  ip: '192.168.1.5',
  model: 'OLED55C1',
  productName: 'webOSTV 6.0',
  paired: true,
  apps: ['com.webos.app.browser'],
  ompVersion: null,
  ...o,
});

const atv = (o: Partial<AtvFacts> = {}): AtvFacts => ({
  kind: 'atv',
  name: 'Chromecast «Спальня»',
  ip: '192.168.1.9',
  model: 'Google TV',
  cast: 'tv',
  ompVersion: null,
  ...o,
});

const states = (p: { steps: { state: string }[] }) => p.steps.map((s) => s.state);
const ids = (p: { actions: { id: string }[] }) => p.actions.map((a) => a.id);

describe('parseWebOs', () => {
  it('reads the product name', () => {
    expect(parseWebOs({ productName: 'webOSTV 4.5' })).toEqual({ label: 'webOS 4.5', rank: 4.5 });
    expect(parseWebOs({ productName: 'webOSTV 6.0' })).toEqual({ label: 'webOS 6.0', rank: 6 });
    expect(parseWebOs({ productName: 'webOS TV 23' })).toEqual({ label: 'webOS 23', rank: 23 });
    expect(parseWebOs({ productName: 'webOSTV 3.5' })).toEqual({ label: 'webOS 3.5', rank: 3.5 });
  });

  it('falls back to the firmware code name year', () => {
    expect(parseWebOs({ swModel: 'HE_DTV_W16P_AFADABAA' })).toEqual({ label: 'webOS 3.0', rank: 3 });
    expect(parseWebOs({ swModel: 'HE_DTV_W18H_AFADABAA' })).toEqual({ label: 'webOS 4.0', rank: 4 });
    expect(parseWebOs({ swModel: 'HE_DTV_W19H_AFADABAA' })).toEqual({ label: 'webOS 4.5', rank: 4.5 });
    expect(parseWebOs({ swModel: 'HE_DTV_W21O_AFABATAA' })).toEqual({ label: 'webOS 6.0', rank: 6 });
    expect(parseWebOs({ swModel: 'HE_DTV_W22O_AFABATAA' })).toEqual({ label: 'webOS 22', rank: 22 });
    expect(parseWebOs({ swModel: 'HE_DTV_W24P_AFABATAA' })).toEqual({ label: 'webOS 24', rank: 24 });
  });

  it('maps the platform major of 2022+ firmware to the year names', () => {
    expect(parseWebOs({ productName: 'webOSTV 7.0' })).toEqual({ label: 'webOS 22', rank: 22 });
    expect(parseWebOs({ productName: 'webOSTV 8.0' })).toEqual({ label: 'webOS 23', rank: 23 });
    expect(parseWebOs({ productName: 'webOSTV 9.0' })).toEqual({ label: 'webOS 24', rank: 24 });
    expect(parseWebOs({ productName: 'webOSTV 10.1' })).toEqual({ label: 'webOS 25', rank: 25 });
  });

  it('2014 sets (W14, webOS 1.x) are recognised', () => {
    expect(parseWebOs({ swModel: 'HE_DTV_W14H_AFADABAA' })).toEqual({ label: 'webOS 1.0', rank: 1 });
  });

  it('prefers the product name (Re:New upgrades), then the code name, then the model year', () => {
    expect(parseWebOs({ productName: 'webOSTV 9.0', swModel: 'HE_DTV_W22O_X', model: 'OLED55C2' })!.label).toBe('webOS 24');
    expect(parseWebOs({ productName: 'Other', swModel: 'HE_DTV_W21O_X', model: 'OLED55C9' })!.label).toBe('webOS 6.0');
    expect(parseWebOs({ model: 'OLED55C1RLA' })).toEqual({ label: 'webOS 6.0 (по году модели)', rank: 6 });
  });

  it('model year of LG retail models', () => {
    expect(lgModelYear('OLED55C1RLA')).toBe(21);
    expect(lgModelYear('OLED65CXRLA')).toBe(20);
    expect(lgModelYear('OLED55B9')).toBe(19);
    expect(lgModelYear('OLED55C8PLA')).toBe(18);
    expect(lgModelYear('OLED55C3')).toBe(23);
    expect(lgModelYear('43UM7300PLB')).toBe(19);
    expect(lgModelYear('49UJ6300')).toBe(17);
    expect(lgModelYear('55UQ75006LF')).toBe(22);
    expect(lgModelYear('LG Smart TV')).toBeNull();
    expect(lgModelYear(undefined)).toBeNull();
    expect(parseWebOs({ model: '49UJ6300' })!.rank).toBe(3.5);
  });

  it('returns null for nothing recognisable', () => {
    expect(parseWebOs({})).toBeNull();
    expect(parseWebOs({ productName: 'TV', swModel: 'HE_DTV', model: 'x' })).toBeNull();
  });
});

describe('androidLabel / isArm64', () => {
  it('names Android versions', () => {
    expect(androidLabel(26)).toBe('Android 8');
    expect(androidLabel(30)).toBe('Android 11');
    expect(androidLabel(31)).toBe('Android 12');
    expect(androidLabel(40)).toBe('Android (API 40)');
    expect(androidLabel(undefined)).toBeNull();
    expect(androidLabel(20)).toBeNull();
  });

  it('recognises arm64', () => {
    expect(isArm64('arm64-v8a')).toBe(true);
    expect(isArm64('aarch64')).toBe(true);
    expect(isArm64('armeabi-v7a')).toBe(false);
    expect(isArm64('x86')).toBe(false);
    expect(isArm64(undefined)).toBe(false);
  });
});

describe('installPlan — LG', () => {
  it('asks to pair first when only discovery data is known', () => {
    const p = installPlan(lg({ paired: false, apps: undefined, ompVersion: undefined, productName: undefined }));
    expect(p.kind).toBe('lg-pair');
    expect(ids(p)).toEqual(['pair', 'faq']);
    expect(p.actions[0].label).toBe('Подключиться');
    expect(p.subtitle).toBe('OLED55C1 · webOS 6.0 (по году модели) · нужно подключение к ТВ');
    expect(p.install).toBeUndefined();
  });

  it('shows the pairing error and offers a retry', () => {
    const p = installPlan(lg({ paired: false, error: 'Подключение отклонено на телевизоре' }));
    expect(p.notes).toEqual(['Подключение отклонено на телевизоре']);
    expect(p.actions[0].label).toBe('Подключиться снова');
  });

  it('webOS older than 4 is not supported', () => {
    const p = installPlan(lg({ productName: 'webOSTV 3.5' }));
    expect(p.kind).toBe('lg-unsupported');
    expect(p.subtitle).toBe('OLED55C1 · webOS 3.5 · не поддерживается');
    expect(p.notes[0]).toContain('webOS 4.0 или новее');
    expect(p.install).toBeUndefined();
    expect(ids(p)).toEqual(['faq']);
  });

  it('paired but the app list is unknown: no install, a recheck and a note', () => {
    const p = installPlan(lg({ apps: undefined, ompVersion: undefined }));
    expect(p.kind).toBe('lg-devmode');
    expect(p.install).toBeUndefined();
    expect(ids(p)[0]).toBe('recheck');
    expect(ids(p)).not.toContain('install');
    expect(p.notes.join(' ')).toContain('Не удалось получить список приложений');
  });

  it('OMP without a version in the list: installed, no update offered', () => {
    const p = installPlan(lg({ ompVersion: '', latest: '0.13.1' }));
    expect(p.kind).toBe('lg-update');
    expect(p.steps[0].text).toBe('Версия неизвестна');
    expect(p.actions).toEqual([]);
    expect(p.subtitle).toBe('OLED55C1 · webOS 6.0 · OMP установлен');
  });

  it('webOS 4.0 is supported', () => {
    expect(installPlan(lg({ productName: 'webOSTV 4.0' })).kind).toBe('lg-devmode');
  });

  it('OMP installed: version and «Обновить на ТВ» when a newer one exists', () => {
    const p = installPlan(lg({ ompVersion: '0.12.1', latest: '0.13.1', apps: [LG_OMP_APP_ID] }));
    expect(p.kind).toBe('lg-update');
    expect(p.installed).toBe('0.12.1');
    expect(p.needsUpdate).toBe(true);
    expect(p.steps[0]).toEqual({ id: 'omp', title: 'OMP установлен', text: 'Версия 0.12.1 — есть 0.13.1', state: 'done' });
    expect(p.actions).toEqual([{ id: 'update-on-tv', label: 'Обновить на ТВ', primary: true }]);
    expect(p.subtitle).toBe('OLED55C1 · webOS 6.0 · OMP 0.12.1');
  });

  it('OMP up to date: no update action', () => {
    const p = installPlan(lg({ ompVersion: '0.13.1', latest: '0.13.1' }));
    expect(p.needsUpdate).toBe(false);
    expect(p.actions).toEqual([]);
    expect(p.steps[0].text).toBe('Версия 0.13.1 — последняя версия');
    expect(installPlan(lg({ ompVersion: '0.13.1', latest: null })).steps[0].text).toBe('Версия 0.13.1');
  });

  it('OMP via Developer Mode without HBC reminds about the 1000 hours', () => {
    const p = installPlan(lg({ ompVersion: '0.13.1', apps: [LG_DEVMODE_APP_ID] }));
    expect(p.notes.join(' ')).toContain('1000 часов');
    expect(installPlan(lg({ ompVersion: '0.13.1', apps: [LG_DEVMODE_APP_ID, LG_HBC_APP_ID] })).notes).toEqual([]);
  });

  it('Homebrew Channel present: open it on the TV with the repository', () => {
    const p = installPlan(lg({ apps: [LG_HBC_APP_ID] }));
    expect(p.kind).toBe('lg-hbc');
    expect(p.subtitle).toBe('OLED55C1 · webOS 6.0 · есть Homebrew Channel');
    expect(states(p)).toEqual(['done', 'current', 'todo']);
    expect(ids(p)).toEqual(['open-hbc', 'faq']);
    expect(p.actions[0]).toEqual({ id: 'open-hbc', label: 'Открыть Homebrew Channel на ТВ', primary: true });
    expect(p.install).toBeUndefined();
  });

  it('Homebrew Channel with Dev Mode SSH open can also install from the phone', () => {
    const p = installPlan(lg({ apps: [LG_HBC_APP_ID], openPorts: [LG_SSH_PORT] }));
    expect(ids(p)).toEqual(['open-hbc', 'install', 'faq']);
    expect(p.install).toEqual({ method: 'lg-devmode', ip: '192.168.1.5', withHbc: false });
  });

  it('nothing installed: the Developer Mode path from the first step', () => {
    const p = installPlan(lg());
    expect(p.kind).toBe('lg-devmode');
    expect(p.subtitle).toBe('OLED55C1 · webOS 6.0 · без root — ставим через режим разработчика');
    expect(p.steps.map((s) => s.title)).toEqual([
      'Аккаунт разработчика LG',
      'Приложение Developer Mode',
      'Dev Mode Status',
      'Key Server',
      'Установка',
      'Таймер 1000 часов',
    ]);
    expect(states(p)).toEqual(['current', 'todo', 'todo', 'todo', 'todo', 'todo']);
    expect(p.install).toEqual({ method: 'lg-devmode', ip: '192.168.1.5', withHbc: true });
    expect(p.actions[0]).toEqual({ id: 'install', label: 'Установить OMP и Homebrew Channel', primary: true });
    expect(p.actions.find((a) => a.id === 'link')!.url).toBe(ROOT_CHECK_URL);
    expect(p.actions.find((a) => a.id === 'faq')!.faq).toBe(FAQ_LG_DEVMODE);
  });

  it('Developer Mode app found: account and app are done', () => {
    expect(states(installPlan(lg({ apps: [LG_DEVMODE_APP_ID] })))).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo']);
  });

  it('SSH port open: Dev Mode Status is on', () => {
    expect(states(installPlan(lg({ openPorts: [LG_SSH_PORT] })))).toEqual(['done', 'done', 'done', 'current', 'todo', 'todo']);
  });

  it('Key Server answering: the install step is current, the timer never is', () => {
    const p = installPlan(lg({ apps: [LG_DEVMODE_APP_ID], openPorts: [LG_SSH_PORT, LG_KEY_SERVER_PORT] }));
    expect(states(p)).toEqual(['done', 'done', 'done', 'done', 'current', 'todo']);
  });

  it('unknown webOS version: a note, the path still shown', () => {
    const p = installPlan(lg({ productName: undefined, model: 'LG TV' }));
    expect(p.kind).toBe('lg-devmode');
    expect(p.notes[0]).toContain('Не удалось узнать версию webOS');
    expect(p.subtitle).toBe('LG TV · без root — ставим через режим разработчика');
  });
});

describe('installPlan — Android TV', () => {
  it('OMP installed: version and update', () => {
    const p = installPlan(atv({ ompVersion: '0.12.0', latest: '0.13.1' }));
    expect(p.kind).toBe('atv-installed');
    expect(p.needsUpdate).toBe(true);
    expect(ids(p)).toEqual(['update-on-tv']);
    expect(p.subtitle).toBe('Google TV · OMP 0.12.0');
    expect(installPlan(atv({ ompVersion: '0.13.1', latest: '0.13.1' })).actions).toEqual([]);
  });

  it('no OMP and nothing known: network debugging, with the Android 11+ hint and the arm64 note', () => {
    const p = installPlan(atv());
    expect(p.kind).toBe('atv-adb');
    expect(p.steps.map((s) => s.title)).toEqual(['Режим разработчика', 'Отладка по сети', 'Установка']);
    expect(p.steps[1].text).toContain('Беспроводная отладка');
    expect(p.steps[1].text).toContain('понадобится компьютер');
    expect(states(p)).toEqual(['current', 'todo', 'todo']);
    expect(p.install).toEqual({ method: 'atv-adb', ip: '192.168.1.9', wireless: null });
    expect(p.notes.join(' ')).toContain('arm64');
    expect(p.actions[0]).toEqual({ id: 'install', label: 'Установить OMP', primary: true });
  });

  it('Android 11+: network debugging if offered, pairing by code is not supported', () => {
    const p = installPlan(atv({ sdkInt: 31, abi: 'arm64-v8a', cast: undefined }));
    expect(p.steps[1].title).toBe('Отладка по сети');
    expect(p.steps[1].text).toContain('телефон пока не поддерживает');
    expect(p.install).toEqual({ method: 'atv-adb', ip: '192.168.1.9', wireless: true });
    expect(p.subtitle).toBe('Google TV · Android 12 · arm64 — встроенный TorrServer будет работать');
    expect(p.notes).toEqual([]);
  });

  it('Android 10 and older: plain network debugging', () => {
    const p = installPlan(atv({ sdkInt: 28, abi: 'armeabi-v7a' }));
    expect(p.steps[1].title).toBe('Отладка по сети');
    expect(p.steps[1].text).not.toContain('Беспроводная');
    expect(p.install).toEqual({ method: 'atv-adb', ip: '192.168.1.9', wireless: false });
    expect(p.subtitle).toBe('Google TV · Android 9 · armeabi-v7a');
    expect(p.notes.join(' ')).toContain('не запустится');
    expect(p.steps[1].text).toContain('Отладка по USB');
  });

  it('a plain «Chromecast» model gets a hint about the old dongles', () => {
    expect(installPlan(atv({ model: 'Chromecast' })).notes.join(' ')).toContain('Chromecast без Google TV');
    expect(installPlan(atv({ model: 'Chromecast HD' })).notes.join(' ')).not.toContain('без Google TV');
  });

  it('found over cast: a note that TVs with only built-in Chromecast cannot take adb', () => {
    expect(installPlan(atv()).notes[0]).toContain('только встроенный Chromecast');
    expect(installPlan(atv({ cast: undefined })).notes.join(' ')).not.toContain('встроенный Chromecast');
  });

  it('a Chromecast without Google TV is not supported', () => {
    const p = installPlan(atv({ cast: 'chromecast', model: 'Chromecast' }));
    expect(p.kind).toBe('atv-unsupported');
    expect(p.install).toBeUndefined();
  });

  it('without a model it says Android TV', () => {
    expect(installPlan(atv({ model: undefined })).subtitle).toBe('Android TV');
  });
});

describe('installPlan — Samsung', () => {
  it('is not supported yet', () => {
    const p = installPlan({ kind: 'samsung', name: 'Samsung', ip: '192.168.1.3' });
    expect(p.kind).toBe('samsung-unsupported');
    expect(p.notes[0]).toContain('пока не поддерживается');
    expect(p.actions[0].faq).toBe(FAQ_SAMSUNG);
  });
});

describe('FAQ links', () => {
  it('every FAQ question the plans link to exists', () => {
    const plans = [
      installPlan(lg({ paired: false })),
      installPlan(lg({ productName: 'webOSTV 3.0' })),
      installPlan(lg({ apps: [LG_HBC_APP_ID] })),
      installPlan(lg()),
      installPlan(atv()),
      installPlan(atv({ cast: 'chromecast' })),
      installPlan({ kind: 'samsung', name: 'S', ip: '1.1.1.1' }),
    ];
    for (const p of plans) for (const a of p.actions) if (a.id === 'faq') expect(resolveFaqLink(a.faq), a.faq).not.toBeNull();
  });
});
