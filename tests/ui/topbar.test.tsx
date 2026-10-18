import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { init, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { TopBar, topBarKeys } from '../../src/ui/TopBar';
import { stepKey, barArrow } from '../../src/ui/focus';
import { newsUnseen } from '../../src/phone/monitor';
import { latestUpdate } from '../../src/store/updates';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  (Element.prototype as any).scrollIntoView = () => undefined;
});

function mount(over: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const props = {
    tab: 'all', onTab: vi.fn(), view: 'large', sort: 'new', searchOpen: false,
    onSearch: vi.fn(), onView: vi.fn(), onSort: vi.fn(), onFocused: vi.fn(), ...over,
  };
  render(h(TopBar as any, props), host);
  return { host, props };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TopBar', () => {
  it('renders tabs with history first and marks the active one', () => {
    const { host } = mount({ tab: 'tv' });
    const tabs = Array.prototype.map.call(host.querySelectorAll('.tab'), (e: Element) => e.textContent);
    expect(tabs).toEqual(['История', 'Новое', 'Обзор', 'Все', 'Фильмы', 'Сериалы', 'Музыка', 'Аудиокниги', 'Прочее']);
    expect(host.querySelector('.tab.active')!.textContent).toBe('Сериалы');
  });
  it('shows the unseen findings count on «Новое» only when there are some', () => {
    newsUnseen.value = 0;
    let host = mount().host;
    expect(host.querySelector('.tab-badge')).toBeNull();
    document.body.innerHTML = '';
    newsUnseen.value = 120;
    host = mount().host;
    expect(host.querySelector('[data-fk="tab-news"] .tab-badge')!.textContent).toBe('99+');
    newsUnseen.value = 0;
  });
  it('a found update puts a dot on «Настройки» only', () => {
    latestUpdate.value = null;
    let host = mount().host;
    expect(host.querySelector('.icon-dot')).toBeNull();
    document.body.innerHTML = '';
    latestUpdate.value = { version: '9.0.0', ipkUrl: 'https://x/a.ipk', ipkHash: 'b'.repeat(64), ipkSize: 1, notes: [], releaseUrl: 'https://x/r' };
    host = mount().host;
    expect(host.querySelectorAll('.icon-dot')).toHaveLength(1);
    expect(host.querySelector('[data-fk="lib-btn-settings"] .icon-dot')).not.toBeNull();
    latestUpdate.value = null;
  });
  it('«Новое» has no library search, view or sort', () => {
    const { host } = mount({ tab: 'news' });
    const buttons = host.querySelectorAll('.icon-button');
    expect(buttons[0].className).toContain('disabled');
    expect(buttons[1].className).toContain('disabled');
    expect(buttons[2].className).toContain('disabled');
  });
  it('labels icon buttons with the current view and sort', () => {
    const { host } = mount({ view: 'list', sort: 'size' });
    const labels = Array.prototype.map.call(host.querySelectorAll('.icon-button'), (e: Element) => e.getAttribute('aria-label'));
    expect(labels).toEqual(['Поиск', 'Вид: Список', 'Сортировка: По размеру', 'Найти раздачу', 'Плейлисты', 'Настройки']);
  });
  it('fires actions on click and disables the view button on history', () => {
    const { host, props } = mount({ tab: 'history' });
    const buttons = host.querySelectorAll('.icon-button');
    (buttons[0] as HTMLElement).click();
    (buttons[2] as HTMLElement).click();
    expect(props.onSearch).toHaveBeenCalled();
    expect(props.onSort).toHaveBeenCalled();
    expect(buttons[1].className).toContain('disabled');
    (buttons[1] as HTMLElement).click();
    expect(props.onView).not.toHaveBeenCalled();
  });
});

describe('TopBar icon labels', () => {
  it('shows the label only on the focused icon button', async () => {
    const { act } = await import('preact/test-utils');
    const { setFocus } = await import('@noriginmedia/norigin-spatial-navigation');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const props = { tab: 'all', onTab: vi.fn(), view: 'large', sort: 'size', searchOpen: false, onSearch: vi.fn(), onView: vi.fn(), onSort: vi.fn(), onFocused: vi.fn() };
    await act(() => { render(h(TopBar as any, props), host); });
    expect(host.querySelector('.icon-btn-label')).toBeNull();
    await act(() => { setFocus('lib-btn-sort'); });
    await act(() => Promise.resolve());
    const sort = host.querySelector('[data-fk="lib-btn-sort"]')!;
    expect(sort.querySelector('.icon-btn-label')!.textContent).toBe('Сортировка: По размеру');
    await act(() => { setFocus('lib-btn-add'); });
    await act(() => Promise.resolve());
    expect(sort.querySelector('.icon-btn-label')).toBeNull();
    expect(host.querySelector('[data-fk="lib-btn-add"] .icon-btn-label')!.textContent).toBe('Найти раздачу');
    expect(host.querySelectorAll('.icon-btn-label').length).toBe(1);
    // the button does not grow: the icon stays its only flow child besides the absolutely placed chip
    expect(host.querySelector('[data-fk="lib-btn-add"] .icon-btn-label')!.className).toBe('icon-btn-label');
    await act(() => { render(null, host); });
  });
  it('pins the labels of the last buttons to their right edge and keeps the update dot', async () => {
    const { act } = await import('preact/test-utils');
    const { setFocus } = await import('@noriginmedia/norigin-spatial-navigation');
    latestUpdate.value = { version: '9.0.0', ipkUrl: 'https://x/a.ipk', ipkHash: 'b'.repeat(64), ipkSize: 1, notes: [], releaseUrl: 'https://x/r' };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const props = { tab: 'all', onTab: vi.fn(), view: 'large', sort: 'size', searchOpen: false, onSearch: vi.fn(), onView: vi.fn(), onSort: vi.fn(), onFocused: vi.fn() };
    await act(() => { render(h(TopBar as any, props), host); });
    await act(() => { setFocus('lib-btn-settings'); });
    await act(() => Promise.resolve());
    const settings = host.querySelector('[data-fk="lib-btn-settings"]')!;
    const label = settings.querySelector('.icon-btn-label')!;
    expect(label.textContent).toBe('Настройки');
    expect(label.classList.contains('icon-btn-label--end')).toBe(true);
    expect(settings.querySelector('.icon-dot')).not.toBeNull();
    await act(() => { setFocus('lib-btn-playlist'); });
    await act(() => Promise.resolve());
    expect(host.querySelector('[data-fk="lib-btn-playlist"] .icon-btn-label--end')!.textContent).toBe('Плейлисты');
    expect(host.querySelectorAll('.icon-btn-label').length).toBe(1);
    await act(() => { setFocus('lib-btn-sort'); });
    await act(() => Promise.resolve());
    expect(host.querySelector('[data-fk="lib-btn-sort"] .icon-btn-label')!.className).toBe('icon-btn-label');
    await act(() => { render(null, host); });
    latestUpdate.value = null;
  });
});

describe('top bar neighbours', () => {
  const order = [
    'tab-history', 'tab-news', 'tab-discover', 'tab-all', 'tab-movie', 'tab-tv', 'tab-music', 'tab-audiobook', 'tab-other',
    'lib-btn-search', 'lib-btn-view', 'lib-btn-sort', 'lib-btn-add', 'lib-btn-playlist', 'lib-btn-settings',
  ];
  const enabled = (skip: string[]) => (k: string) => skip.indexOf(k) < 0;

  it('lists every tab and every icon, left to right', () => {
    expect(topBarKeys()).toEqual(order);
  });

  it('steps to the next enabled neighbour and stops at either end', () => {
    expect(stepKey(order, 'tab-news', 1, enabled([]))).toBe('tab-discover');
    expect(stepKey(order, 'tab-other', 1, enabled([]))).toBe('lib-btn-search');
    expect(stepKey(order, 'lib-btn-view', -1, enabled([]))).toBe('lib-btn-search');
    expect(stepKey(order, 'lib-btn-search', -1, enabled([]))).toBe('tab-other');
    expect(stepKey(order, 'tab-other', 1, enabled(['lib-btn-search', 'lib-btn-view', 'lib-btn-sort']))).toBe('lib-btn-add');
    expect(stepKey(order, 'lib-btn-sort', -1, enabled(['lib-btn-search', 'lib-btn-view']))).toBe('tab-other');
    expect(stepKey(order, 'tab-history', -1, enabled([]))).toBeNull();
    expect(stepKey(order, 'lib-btn-settings', 1, enabled([]))).toBeNull();
  });

  const press = async (key: string) => {
    const { act } = await import('preact/test-utils');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  };
  const focus = async (key: string) => {
    const { act } = await import('preact/test-utils');
    await act(() => { setFocus(key); });
    await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
  };

  it('walks the mounted bar in order, skipping disabled icons', async () => {
    const { act } = await import('preact/test-utils');
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(() => { render(h(TopBar as any, { tab: 'news', onTab: vi.fn(), view: 'large', sort: 'new', searchOpen: false, onSearch: vi.fn(), onView: vi.fn(), onSort: vi.fn(), onFocused: vi.fn() }), host); });
    await focus('tab-news');
    await press('ArrowRight');
    expect(getCurrentFocusKey()).toBe('tab-discover');
    await focus('tab-other');
    await press('ArrowRight');
    expect(getCurrentFocusKey()).toBe('lib-btn-add');
    await press('ArrowLeft');
    expect(getCurrentFocusKey()).toBe('tab-other');
    await act(() => { render(null, host); });
  });

  it('reaches search from the last tab and from the view icon', async () => {
    const { act } = await import('preact/test-utils');
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(() => { render(h(TopBar as any, { tab: 'all', onTab: vi.fn(), view: 'large', sort: 'new', searchOpen: false, onSearch: vi.fn(), onView: vi.fn(), onSort: vi.fn(), onFocused: vi.fn() }), host); });
    await focus('tab-other');
    await press('ArrowRight');
    expect(getCurrentFocusKey()).toBe('lib-btn-search');
    await press('ArrowLeft');
    expect(getCurrentFocusKey()).toBe('tab-other');
    await focus('lib-btn-view');
    await press('ArrowLeft');
    expect(getCurrentFocusKey()).toBe('lib-btn-search');
    await act(() => { render(null, host); });
  });

  it('keeps Down on the bar when nothing under it can take focus', async () => {
    const { act } = await import('preact/test-utils');
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(() => { render(h(TopBar as any, { tab: 'other', onTab: vi.fn(), view: 'large', sort: 'new', searchOpen: false, onSearch: vi.fn(), onView: vi.fn(), onSort: vi.fn(), onFocused: vi.fn() }), host); });
    await focus('lib-btn-settings');
    await press('ArrowDown');
    expect(getCurrentFocusKey()).toBe('lib-btn-settings');
    const leave = barArrow(['lib-btn-settings'], 'lib-btn-settings', () => true, () => true);
    expect(leave('down')).toBe(true);
    expect(leave('up')).toBe(false);
    await act(() => { render(null, host); });
  });

  it('scrolls a clipped tab clear of the fade and marks the overflowing edge', async () => {
    const { act } = await import('preact/test-utils');
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(() => { render(h(TopBar as any, { tab: 'all', onTab: vi.fn(), view: 'large', sort: 'new', searchOpen: false, onSearch: vi.fn(), onView: vi.fn(), onSort: vi.fn(), onFocused: vi.fn() }), host); });
    const box = host.querySelector('.topbar-tabs') as HTMLElement;
    const el = host.querySelector('[data-fk="tab-history"]') as HTMLElement;
    const rect = (left: number, right: number) => ({
      left: left, right: right, top: 0, bottom: 60, width: right - left, height: 60, x: left, y: 0, toJSON: () => ({}),
    });
    box.getBoundingClientRect = () => rect(0, 400) as DOMRect;
    el.getBoundingClientRect = () => rect(-30, 90) as DOMRect;
    Object.defineProperty(box, 'scrollWidth', { configurable: true, value: 1400 });
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: 400 });
    box.scrollLeft = 80;
    await focus('tab-history');
    expect(box.scrollLeft).toBe(2);
    expect(box.classList.contains('fade-left')).toBe(false);
    expect(box.classList.contains('fade-right')).toBe(true);
    await act(() => { render(null, host); });
  });
});
