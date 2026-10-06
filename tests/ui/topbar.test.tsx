import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { TopBar } from '../../src/ui/TopBar';

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
    expect(tabs).toEqual(['История', 'Обзор', 'Все', 'Фильмы', 'Сериалы', 'Музыка', 'Прочее']);
    expect(host.querySelector('.tab.active')!.textContent).toBe('Сериалы');
  });
  it('labels icon buttons with the current view and sort', () => {
    const { host } = mount({ view: 'list', sort: 'size' });
    const labels = Array.prototype.map.call(host.querySelectorAll('.icon-button'), (e: Element) => e.getAttribute('aria-label'));
    expect(labels).toEqual(['Поиск', 'Вид: Список', 'Сортировка: По размеру', 'Добавить', 'Плейлисты', 'Настройки']);
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
    expect(host.querySelector('[data-fk="lib-btn-add"] .icon-btn-label')!.textContent).toBe('Добавить');
    expect(host.querySelectorAll('.icon-btn-label').length).toBe(1);
    await act(() => { render(null, host); });
  });
});
