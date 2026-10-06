import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { TopBar } from '../../src/ui/TopBar';
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
    expect(tabs).toEqual(['История', 'Новое', 'Обзор', 'Все', 'Фильмы', 'Сериалы', 'Музыка', 'Прочее']);
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

describe('TopBar expanding icons', () => {
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
    await act(() => { render(null, host); });
  });
});
