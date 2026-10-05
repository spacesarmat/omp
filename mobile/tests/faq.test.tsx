import { applyLanguageSetting } from '../../src/i18n';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Faq, highlightFaq, normalizeFaq, searchFaq } from '../src/screens/Faq';
import { Settings } from '../src/screens/Settings';
import { DEVICES, FAQ, OLD_Q_LINKS, SECTIONS, itemFor, resolveFaqLink, type FaqLine } from '../src/faq';
import { currentRoute, resetTo, routeStack } from '../src/nav';
import { HB_REPO_URL, RELEASES_URL } from '../../src/lib/updateInfo';
import { localServer } from '../src/server/localServer';
import { saveTv, setActiveTv, tvs, activeTvIp } from '../src/tv/tvStore';
import {
  FAQ_ATV_ADB,
  FAQ_ATV_BOXES,
  FAQ_LG_DEVMODE,
  FAQ_LG_HBC,
  FAQ_LG_ROOT,
  FAQ_LG_VERSION,
  FAQ_SAMSUNG,
} from '../../src/lib/installPlan';

function mount(ui: preact.VNode): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(ui, el));
  return el;
}
const q = (el: HTMLElement, t: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('.m-faq-q')).find((b) => b.textContent!.includes(t))!;
const chip = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('.m-chip')).find((b) => b.textContent === t)!;
const on = (el: HTMLElement) => el.querySelector('.m-chip.on')!.textContent;
const search = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Поиск по вопросам"]')!;
async function type(el: HTMLElement, v: string) {
  await act(async () => {
    const i = search(el);
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  tvs.value = [];
  activeTvIp.value = null;
  localServer.value = { supported: false, running: false };
  resetTo({ name: 'settings' });
});
afterEach(() => vi.restoreAllMocks());

const urls = (lines: FaqLine[]) => lines.filter((l): l is { text: string; url: string } => typeof l !== 'string').map((l) => l.url);

describe('FAQ data', () => {
  it('has unique ids, known sections, and at least one device per item', () => {
    const ids = FAQ.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const it of FAQ) {
      expect(it.devices.length).toBeGreaterThan(0);
      expect(SECTIONS.some((s) => s.id === it.section)).toBe(true);
      expect(it.short.length).toBeGreaterThan(0);
      expect(it.short.length).toBeLessThanOrEqual(6);
      for (const d of Object.keys(it.by ?? {})) expect(it.devices).toContain(d);
    }
    expect(DEVICES.map((d) => d.label)).toEqual(['Телевизор LG', 'Android TV', 'Телефон', 'TorrServer', 'Общее']);
    for (const d of DEVICES) expect(FAQ.some((i) => i.devices.includes(d.id))).toBe(true);
  });

  it('keeps every link and the Homebrew repository URL of the old FAQ', () => {
    const all = new Set<string>();
    let text = '';
    for (const it of FAQ) {
      for (const d of it.devices) {
        const v = itemFor(it, d);
        urls([...v.short, ...v.more]).forEach((u) => all.add(u));
        text += [...v.short, ...v.more].map((l) => (typeof l === 'string' ? l : l.text)).join('\n');
      }
    }
    for (const u of [
      'https://cani.rootmy.tv',
      'https://www.webosbrew.org/rooting/',
      'https://webostv.developer.lge.com',
      'https://github.com/webosbrew/dev-manager-desktop/releases/latest',
      'https://github.com/webosbrew/webos-homebrew-channel/releases/latest',
      RELEASES_URL,
      'https://github.com/YouROK/TorrServer',
      'https://boosty.to/djmaker/donate',
    ]) {
      expect(all.has(u), u).toBe(true);
    }
    expect(text).toContain(HB_REPO_URL);
  });

  it('maps all 41 old questions to existing items, including the install-plan deep links', () => {
    expect(Object.keys(OLD_Q_LINKS)).toHaveLength(41);
    for (const [old, t] of Object.entries(OLD_Q_LINKS)) {
      const it = FAQ.find((i) => i.id === t.id);
      expect(it, old).toBeDefined();
      expect(it!.devices, old).toContain(t.device);
    }
    expect(resolveFaqLink(FAQ_LG_DEVMODE)).toEqual({ id: 'lg-devmode', device: 'lg' });
    expect(resolveFaqLink(FAQ_LG_HBC)!.id).toBe('lg-hbc');
    expect(resolveFaqLink(FAQ_LG_ROOT)!.id).toBe('lg-root');
    expect(resolveFaqLink(FAQ_LG_VERSION)!.id).toBe('lg-version');
    expect(resolveFaqLink(FAQ_ATV_ADB)).toEqual({ id: 'atv-adb', device: 'atv' });
    expect(resolveFaqLink(FAQ_ATV_BOXES)).toEqual({ id: 'atv-boxes', device: 'atv' });
    expect(resolveFaqLink(FAQ_SAMSUNG)).toEqual({ id: 'samsung', device: 'common' });
    expect(resolveFaqLink('lg-update')).toEqual({ id: 'lg-update', device: 'lg' });
    expect(resolveFaqLink('nope')).toBeNull();
  });
});

const viewText = (id: string, d: 'lg' | 'atv' | 'phone' | 'server' | 'common') => {
  const v = itemFor(FAQ.find((i) => i.id === id)!, d);
  return [v.q, ...v.short, ...v.more].map((l) => (typeof l === 'string' ? l : l.text)).join(' | ');
};
const deviceText = (d: 'lg' | 'atv' | 'phone' | 'server' | 'common') =>
  FAQ.filter((i) => i.devices.includes(d)).map((i) => viewText(i.id, d)).join(' | ');

describe('FAQ per-device content', () => {
  it('keeps the key facts under the right device', () => {
    const lg = deviceText('lg');
    for (const f of ['1000 часов', 'webOS 4.0', 'Key Server', 'Passphrase', 'Homebrew Channel', '928 часов', 'ares-install']) expect(lg, f).toContain(f);
    const atv = deviceText('atv');
    for (const f of ['arm64', 'adb connect', '5555', 'Отладк', 'неизвестных источников', 'Android 11', 'AC3', 'Jackett']) expect(atv, f).toContain(f);
    const phone = deviceText('phone');
    for (const f of ['AC3', '3 часа по умолчанию', 'без пароля', 'Boosty', 'omp-копия']) expect(phone, f).toContain(f);
    expect(deviceText('server')).toContain('arm64');
    expect(deviceText('common')).toContain('Tizen');
  });

  it('LG views never show adb or Android TV install steps', () => {
    for (const id of ['helper', 'safety', 'after-install', 'phone-no-control', 'sources-transfer']) {
      if (!FAQ.find((i) => i.id === id)!.devices.includes('lg')) continue;
      const t = viewText(id, 'lg');
      expect(t, id).not.toMatch(/adb|Отладк|порт 5555|Android 10|Android TV и Google TV/);
    }
    expect(viewText('helper', 'lg')).toContain('928 часов');
    expect(viewText('after-install', 'lg')).not.toContain('Сеть и интернет');
  });

  it('Android TV views never show Developer Mode codes or Homebrew steps', () => {
    for (const id of ['helper', 'safety', 'after-install']) {
      const t = viewText(id, 'atv');
      expect(t, id).not.toMatch(/Passphrase|Key Server|Homebrew|928|Дополнительно/);
    }
    expect(viewText('helper', 'atv')).toContain('Android 11');
    expect(viewText('helper', 'atv')).toContain('5555');
    expect(viewText('after-install', 'atv')).toContain('Сеть и интернет');
  });

  it('lists Jackett and the open-server warning where the old FAQ did', () => {
    expect(FAQ.find((i) => i.id === 'jackett')!.devices).toContain('atv');
    expect(FAQ.find((i) => i.id === 'ts-phone')!.short.join(' ')).toContain('без пароля');
    expect(viewText('sources-transfer', 'phone')).not.toContain('Подключить телефон к Android TV');
  });
});

describe('FAQ v0.15 content', () => {
  const ids = (d: 'lg' | 'atv' | 'phone' | 'server' | 'common') => FAQ.filter((i) => i.devices.includes(d)).map((i) => i.id);

  it('the player questions belong to Android TV only', () => {
    for (const id of ['player-engine', 'player-auto', 'player-audio']) expect(FAQ.find((i) => i.id === id)!.devices).toEqual(['atv']);
    const atv = deviceText('atv');
    for (const f of ['VLC', 'Авто', 'FFmpeg', 'passthrough', 'TrueHD', 'ASS', 'сменить на VLC']) expect(atv, f).toContain(f);
    expect(viewText('player-audio', 'atv')).toContain('VLC всегда декодирует звук в PCM');
    expect(viewText('no-sound', 'atv')).toContain('сменить на VLC');
    expect(viewText('no-sound', 'phone')).not.toContain('VLC');
  });

  it('explains which APK to pick and where the releases are posted', () => {
    const it = FAQ.find((i) => i.id === 'apk-choice')!;
    expect(it.devices).toEqual(['phone', 'atv']);
    expect(it.section).toBe('install');
    for (const d of ['phone', 'atv'] as const) for (const f of ['arm64.apk', 'armv7.apk', 'общий']) expect(viewText('apk-choice', d), f).toContain(f);
    // the same advice everywhere: arm64 = 64-bit system, armv7 = 32-bit system (many TV boxes, even on a 64-bit CPU), universal if unsure
    for (const d of ['phone', 'atv'] as const) for (const f of ['64-битн', '32-битн', ' приставки']) expect(viewText('apk-choice', d), f).toContain(f);
    expect(deviceText('atv')).not.toContain('для приставки обычно');
    const tg = urls(FAQ.filter((i) => i.id === 'apk-choice' || i.id === 'telegram').flatMap((i) => [...i.short, ...(i.more ?? [])]));
    expect(tg).toContain('https://t.me/ompplyaer');
    expect(viewText('telegram', 'lg')).toContain('50 МБ');
    expect(viewText('ts-phone', 'phone')).toContain('61 МБ');
    expect(viewText('ts-phone', 'phone')).toContain('Android 10');
  });

  it('describes the direct Jackett and Prowlarr connection on the phone and the TorrServer path on LG', () => {
    const phone = viewText('jackett', 'phone');
    for (const f of ['Искать в сети', 'API-ключ', 'состояние неизвестно', 'защищённом хранилище', '9117', 'без шифрования']) expect(phone, f).toContain(f);
    expect(viewText('jackett', 'atv')).toContain('Передать на телевизор');
    expect(viewText('jackett', 'server')).toContain('Поиск через Torznab');
    const lg = viewText('jackett', 'lg');
    expect(lg).toContain('Поиск через Torznab');
    expect(lg).not.toContain('Индексаторы');
    expect(viewText('sources-transfer', 'atv')).toContain('FlareSolverr');
  });

  it('covers FlareSolverr, the Cloudflare switch, the site logins and the names', () => {
    expect(viewText('flaresolverr', 'phone')).toContain('docker run');
    expect(viewText('flaresolverr', 'phone')).toContain('FlareSolverr is ready!');
    const cf = viewText('cloudflare', 'phone');
    for (const f of ['Обходить проверку Cloudflare', 'выключен', 'правила сайта', 'Пройти на телефоне']) expect(cf, f).toContain(f);
    expect(viewText('cloudflare', 'atv')).toContain('Отметить пультом');
    const login = viewText('sites-login', 'phone');
    for (const f of ['Войти через браузер', 'kinozal.me', 'kinozal.guru', 'kinozal.tv', 'rustorka']) expect(login, f).toContain(f);
    expect(viewText('names', 'phone')).toContain('Переименовать');
    expect(viewText('sources', 'phone')).toContain('Kinozal');
    expect(viewText('sources', 'phone')).not.toMatch(/seedoff|labtor|BitRu/i);
  });

  it('LG items never mention VLC, adb, Cloudflare sites, FlareSolverr or the browser sign-in', () => {
    for (const id of ids('lg')) {
      expect(viewText(id, 'lg'), id).not.toMatch(/VLC|FlareSolverr|Cloudflare|Kinozal|rustorka|Войти через браузер|Отладк/);
      if (id !== 'safety') expect(viewText(id, 'lg'), id).not.toMatch(/adb/);
    }
    expect(ids('lg')).not.toContain('player-engine');
    expect(ids('lg')).not.toContain('cloudflare');
    expect(ids('lg')).not.toContain('sites-login');
  });

  it('no item mentions the dropped sites', () => {
    for (const d of ['lg', 'atv', 'phone', 'server', 'common'] as const) expect(deviceText(d), d).not.toMatch(/seedoff|labtor|BitRu/i);
  });
});

describe('FAQ search', () => {
  it('ignores case and ё/е', () => {
    expect(normalizeFaq('ПодойдЁт')).toBe('подойдет');
    expect(searchFaq('ПОДОЙДЕТ ЛИ').some((h) => h.item.id === 'lg-version')).toBe(true);
    expect(searchFaq('подойдёт').some((h) => h.item.id === 'lg-version')).toBe(true);
  });

  it('matches the short answer and the details, each item once', () => {
    const ids = searchFaq('ares-install').map((h) => h.item.id);
    expect(ids).toEqual(['lg-update']);
    const sound = searchFaq('звук');
    expect(new Set(sound.map((h) => h.item.id)).size).toBe(sound.length);
    expect(sound.length).toBeGreaterThan(1);
    expect(searchFaq('   ')).toEqual([]);
  });

  it('prefers the chosen device for the badge', () => {
    const noSound = (prefer?: 'atv') => searchFaq('нет звука', prefer).find((h) => h.item.id === 'no-sound')!;
    expect(noSound('atv').device).toBe('atv');
    expect(noSound().device).toBe('lg');
  });

  it('highlights the match, e/yo-insensitive', () => {
    expect(highlightFaq('Подойдёт ли', 'нет такого')).toEqual(['Подойдёт ли']);
    const yo = highlightFaq('Ёлка и ёжик', 'елка ЕЖИК') as preact.VNode[];
    expect(yo.filter((x) => typeof x !== 'string').map((x) => x.props.children)).toEqual(['Ёлка', 'ёжик']);
    const hit = highlightFaq('Подойдёт ли', 'ПОДОЙДЕТ') as preact.VNode[];
    expect((hit[0] as preact.VNode).type).toBe('mark');
    expect((hit[0] as preact.VNode).props.children).toBe('Подойдёт');
    expect(hit[1]).toBe(' ли');
  });
});

describe('Faq screen', () => {
  it('defaults to the phone, shows the device sections and collapsed questions', () => {
    const el = mount(<Faq />);
    expect(on(el)).toBe('Телефон');
    expect(el.querySelector('.m-faq-hint')).toBeNull();
    expect(el.querySelector('h1')!.textContent).toBe('Вопросы и ответы');
    const labels = Array.from(el.querySelectorAll('.m-set-label')).map((x) => x.textContent);
    expect(labels).toContain('Установка');
    const buttons = el.querySelectorAll('.m-faq-q');
    expect(buttons.length).toBe(FAQ.filter((i) => i.devices.includes('phone')).length);
    buttons.forEach((b) => expect(b.getAttribute('aria-expanded')).toBe('false'));
    expect(el.querySelector('.m-faq-a')).toBeNull();
  });

  it('switches devices, remembers the choice and restores it', async () => {
    let el = mount(<Faq />);
    await act(async () => chip(el, 'Android TV').click());
    expect(on(el)).toBe('Android TV');
    expect(chip(el, 'Android TV').getAttribute('aria-pressed')).toBe('true');
    expect(q(el, 'Установить через adb')).toBeDefined();
    expect(q(el, 'Нужен ли root')).toBeUndefined();
    expect(localStorage.getItem('tsp.faqDevice')).toBe('"atv"');
    el = mount(<Faq />);
    expect(on(el)).toBe('Android TV');
    expect(el.querySelector('.m-faq-hint')).toBeNull();
  });

  it('ignores a broken stored device', () => {
    localStorage.setItem('tsp.faqDevice', '"toaster"');
    expect(on(mount(<Faq />))).toBe('Телефон');
  });

  it('selects the device by the connected TV and says so', async () => {
    saveTv({ ip: '192.168.1.20', name: 'Гостиная', kind: 'atv', token: 'a'.repeat(32) });
    setActiveTv('192.168.1.20');
    let el = mount(<Faq />);
    expect(on(el)).toBe('Android TV');
    expect(el.querySelector('.m-faq-hint')!.textContent).toBe('Выбрано по подключённому телевизору · Гостиная');
    await act(async () => chip(el, 'Телефон').click());
    expect(el.querySelector('.m-faq-hint')).toBeNull();

    localStorage.clear();
    saveTv({ ip: '192.168.1.21', name: 'LG спальня' });
    setActiveTv('192.168.1.21');
    el = mount(<Faq />);
    expect(on(el)).toBe('Телевизор LG');
    expect(el.querySelector('.m-faq-hint')!.textContent).toContain('LG спальня');
  });

  it('opens one answer at a time with a «Подробнее» for the details', async () => {
    const el = mount(<Faq />);
    await act(async () => chip(el, 'Телевизор LG').click());
    await act(async () => q(el, 'Подойдёт ли мой телевизор?').click());
    expect(q(el, 'Подойдёт ли мой телевизор?').getAttribute('aria-expanded')).toBe('true');
    expect(el.textContent).toContain('webOS 4.0 или новее');
    expect(el.textContent).not.toContain('Телевизоры других марок');
    const more = el.querySelector<HTMLButtonElement>('.m-faq-more')!;
    expect(more.textContent).toBe('Подробнее');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await act(async () => more.click());
    expect(el.textContent).toContain('Телевизоры других марок');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    await act(async () => q(el, 'Нужен ли root').click());
    expect(q(el, 'Подойдёт ли мой телевизор?').getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelectorAll('.m-faq-a').length).toBe(1);
    expect(el.textContent).not.toContain('Телевизоры других марок');
    await act(async () => q(el, 'Нужен ли root').click());
    expect(el.querySelector('.m-faq-a')).toBeNull();
  });

  it('uses the per-device text', async () => {
    const el = mount(<Faq />);
    await act(async () => chip(el, 'Телевизор LG').click());
    expect(q(el, 'Подключить телефон к телевизору')).toBeDefined();
    await act(async () => chip(el, 'Телефон').click());
    expect(q(el, 'Подключить телефон к LG')).toBeDefined();
    expect(q(el, 'Подключить телефон к Android TV')).toBeDefined();
  });

  it('shows the Homebrew repository URL', async () => {
    const el = mount(<Faq />);
    await act(async () => chip(el, 'Телевизор LG').click());
    await act(async () => q(el, 'Homebrew Channel').click());
    expect(el.textContent).toContain(HB_REPO_URL);
  });

  it('opens links externally', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const el = mount(<Faq />);
    await act(async () => chip(el, 'TorrServer').click());
    await act(async () => q(el, 'Что такое TorrServer').click());
    await act(async () => el.querySelector<HTMLButtonElement>('.m-faq-a .m-link')!.click());
    expect(open).toHaveBeenCalledWith('https://github.com/YouROK/TorrServer', '_system');
  });

  it('searches across all devices with badge, section, count and highlight', async () => {
    const el = mount(<Faq />);
    await type(el, 'ЗВУК');
    expect(el.querySelector('[role="status"]')!.textContent).toBe('Найдено 4 · во всех устройствах');
    expect(el.querySelector('.m-chip')).toBeNull();
    const first = q(el, 'Нет звука');
    expect(first.querySelector('.m-faq-badge')!.textContent).toBe('Телефон');
    expect(first.querySelector('.m-faq-sec')!.textContent).toBe('Если что-то не работает');
    expect(first.querySelector('mark')!.textContent).toBe('звук');
    await act(async () => first.click());
    expect(el.textContent).toContain('AC3 и DTS');
    // a hit that matches only in the answer is highlighted there
    await type(el, 'ares-install');
    await act(async () => q(el, 'Как обновить OMP').click());
    await act(async () => el.querySelector<HTMLButtonElement>('.m-faq-more')!.click());
    expect(el.querySelector('.m-faq-a mark')!.textContent).toBe('ares-install');
    expect(el.querySelector('.m-faq-more')!.getAttribute('aria-controls')).toBe('faq-more-lg-update');
    expect(document.getElementById('faq-more-lg-update')).not.toBeNull();
    expect(q(el, 'Как обновить OMP').getAttribute('aria-controls')).toBe('faq-a-lg-update');
    await type(el, 'ёжик-нет-такого');
    expect(el.querySelector('[role="status"]')!.textContent).toContain('Ничего не найдено');
    await type(el, '');
    expect(el.querySelector('.m-chip')).not.toBeNull();
  });

  it('the search input is labelled and rows are real buttons', () => {
    const el = mount(<Faq />);
    expect(search(el).getAttribute('placeholder')).toBe('Поиск: «нет звука», «обновить»…');
    el.querySelectorAll('.m-faq-q').forEach((b) => expect(b.tagName).toBe('BUTTON'));
  });

  it('deep links open the item under its device (old question text or id)', () => {
    let el = mount(<Faq q={FAQ_LG_DEVMODE} />);
    expect(on(el)).toBe('Телевизор LG');
    expect(el.querySelector('.m-faq-item.open')!.textContent).toContain('Developer Mode');
    el = mount(<Faq q="atv-adb" />);
    expect(on(el)).toBe('Android TV');
    expect(el.querySelector('.m-faq-item.open')!.textContent).toContain('adb connect');
    el = mount(<Faq q="unknown" />);
    expect(el.querySelector('.m-faq-item.open')).toBeNull();
  });

  it('back button goes back', async () => {
    const el = mount(<Faq />);
    resetTo({ name: 'settings' });
    routeStack.value = routeStack.value.concat({ name: 'faq' });
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Назад"]')!.click());
    expect(currentRoute.value.name).toBe('settings');
  });
});

describe('Settings entry', () => {
  it('navigates to the FAQ', async () => {
    const el = mount(<Settings />);
    const row = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Вопросы и ответы'))!;
    await act(async () => row.click());
    expect(currentRoute.value.name).toBe('faq');
  });
});

describe('FAQ screen chrome in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));
  // the question and answer texts are migrated with the FAQ data (mobile/src/faq.ts)
  const enSearch = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Search the questions"]')!;

  it('title, search, device group and the details button', async () => {
    const el = mount(<Faq />);
    expect(el.querySelector('h1')!.textContent).toBe('Questions and answers');
    expect(el.querySelector('[aria-label="Back"]')).toBeTruthy();
    expect(enSearch(el).placeholder).toBe('Search: “no sound”, “update”…');
    expect(el.querySelector('[role=group]')!.getAttribute('aria-label')).toBe('Device');
    // open the questions of the phone list one by one until one has details
    for (const q of Array.from(el.querySelectorAll<HTMLButtonElement>('.m-faq-q'))) {
      await act(async () => q.click());
      if (el.querySelector('.m-faq-more')) break;
    }
    expect(el.querySelector('.m-faq-more')!.textContent).toBe('More');
  });

  it('search results line and the TV hint', async () => {
    const el = mount(<Faq />);
    await act(async () => {
      const i = enSearch(el);
      i.value = 'qqqzzz';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(el.querySelector('.m-faq-hint')!.textContent).toBe('Nothing found · in all devices');
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setActiveTv('192.168.1.5');
    const el2 = mount(<Faq />);
    expect(el2.querySelector('.m-faq-hint')!.textContent).toBe('Chosen by the connected TV · LG OLED');
  });
});
