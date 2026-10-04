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
    expect(searchFaq('нет звука', 'atv')[0].device).toBe('atv');
    expect(searchFaq('нет звука')[0].device).toBe('lg');
  });

  it('highlights the match, e/yo-insensitive', () => {
    const parts = highlightFaq('Подойдёт ли', 'подоидет');
    expect(parts).toEqual(['Подойдёт ли']);
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
    const expected = searchFaq('звук').length;
    expect(el.querySelector('[role="status"]')!.textContent).toBe(`Найдено ${expected} · во всех устройствах`);
    expect(el.querySelector('.m-chip')).toBeNull();
    const first = q(el, 'Нет звука');
    expect(first.querySelector('.m-faq-badge')!.textContent).toBe('Телефон');
    expect(first.querySelector('.m-faq-sec')!.textContent).toBe('Если что-то не работает');
    expect(first.querySelector('mark')!.textContent).toBe('звук');
    await act(async () => first.click());
    expect(el.textContent).toContain('AC3 и DTS');
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
