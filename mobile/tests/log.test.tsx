import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Log, setLogActions, filterEntries } from '../src/screens/Log';
import { Settings } from '../src/screens/Settings';
import { currentRoute, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { log, clearLog, logEntries } from '../../src/lib/log';
import { localServer } from '../src/server/localServer';

function mount(ui: preact.VNode): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(ui, el));
  return el;
}
const btn = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes(t))!;
const rows = (el: HTMLElement) => Array.from(el.querySelectorAll('.m-log-text')).map((n) => n.textContent);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function actionsFake(over: Record<string, unknown> = {}) {
  const calls = { copy: [] as string[], open: [] as string[], share: [] as { name: string; text: string }[], confirm: [] as string[] };
  setLogActions({
    copyText: (t) => {
      calls.copy.push(t);
      return Promise.resolve();
    },
    openUrl: (u) => void calls.open.push(u),
    shareText: (o) => {
      calls.share.push(o);
      return Promise.resolve();
    },
    confirm: (t) => {
      calls.confirm.push(t);
      return true;
    },
    phoneName: () => Promise.resolve('Pixel 7'),
    ...over,
  });
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  clearLog();
  resetTo({ name: 'settings' });
  localServer.value = { supported: false, running: false };
  toast.value = '';
});
afterEach(() => {
  setLogActions(null);
  vi.restoreAllMocks();
});

function seed() {
  vi.useFakeTimers();
  log('info', 'app', 'Запуск OMP');
  vi.advanceTimersByTime(1);
  log('info', 'monitor', 'Фоновая проверка: подписок 3');
  vi.advanceTimersByTime(1);
  log('error', 'search', 'rutracker: сайт закрыт');
  vi.useRealTimers();
}

describe('Log screen', () => {
  it('lists newest first and filters', async () => {
    actionsFake();
    seed();
    const el = mount(<Log />);
    expect(rows(el)).toEqual(['rutracker: сайт закрыт', 'Фоновая проверка: подписок 3', 'Запуск OMP']);
    await act(async () => btn(el, 'Ошибки').click());
    expect(rows(el)).toEqual(['rutracker: сайт закрыт']);
    await act(async () => btn(el, 'Мониторинг').click());
    expect(rows(el)).toEqual(['Фоновая проверка: подписок 3']);
    await act(async () => btn(el, 'Все').click());
    expect(rows(el).length).toBe(3);
    expect(el.textContent).toContain('ОШИБКА');
  });
  it('shows an empty state', () => {
    actionsFake();
    expect(mount(<Log />).textContent).toContain('Записей нет');
  });
  it('filterEntries', () => {
    seed();
    expect(filterEntries(logEntries(), 'errors').length).toBe(1);
  });
  it('GitHub: copies the whole log, then opens the issue', async () => {
    const calls = actionsFake();
    seed();
    const el = mount(<Log />);
    await act(async () => btn(el, 'Сообщить об ошибке на GitHub').click());
    await settle();
    expect(calls.copy.length).toBe(1);
    expect(calls.copy[0]).toContain('Модель: Pixel 7');
    expect(calls.copy[0]).toContain('Запуск OMP');
    expect(calls.open.length).toBe(1);
    expect(calls.open[0].startsWith('https://github.com/spacesarmat/omp/issues/new?title=')).toBe(true);
    expect(decodeURIComponent(calls.open[0])).toContain('rutracker: сайт закрыт');
    expect(toast.value).toBe('Журнал скопирован');
  });
  it('GitHub: still opens the issue when copying fails', async () => {
    const calls = actionsFake({ copyText: () => Promise.reject(new Error('x')) });
    const el = mount(<Log />);
    await act(async () => btn(el, 'Сообщить об ошибке на GitHub').click());
    await settle();
    expect(calls.open.length).toBe(1);
    expect(decodeURIComponent(calls.open[0])).toContain('Не удалось скопировать журнал');
    expect(toast.value).toBe('Не удалось скопировать журнал');
  });
  it('share: a dated .txt file with the formatted log', async () => {
    const calls = actionsFake();
    seed();
    const el = mount(<Log />);
    await act(async () => btn(el, 'Поделиться журналом').click());
    await settle();
    expect(calls.share.length).toBe(1);
    expect(calls.share[0].name).toMatch(/^omp-журнал-\d{4}-\d\d-\d\d\.txt$/);
    expect(calls.share[0].text).toContain('OMP: ');
    expect(calls.share[0].text).toContain('rutracker: сайт закрыт');
  });
  it('share: shows the error of the native call', async () => {
    actionsFake({ shareText: () => Promise.reject(new Error('Нет приложения для отправки файла')) });
    const el = mount(<Log />);
    await act(async () => btn(el, 'Поделиться журналом').click());
    await settle();
    expect(toast.value).toBe('Нет приложения для отправки файла');
  });
  it('clear: asks first', async () => {
    const calls = actionsFake({ confirm: () => false });
    seed();
    const el = mount(<Log />);
    await act(async () => btn(el, 'Очистить').click());
    expect(logEntries().length).toBe(3);
    const calls2 = actionsFake();
    await act(async () => btn(el, 'Очистить').click());
    expect(logEntries().length).toBe(0);
    expect(calls2.confirm).toEqual(['Очистить журнал?']);
    expect(calls.confirm.length).toBe(0);
    expect(el.textContent).toContain('Записей нет');
  });
  it('back goes to the previous route', async () => {
    actionsFake();
    resetTo({ name: 'settings' });
    const el = mount(<Log />);
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Назад"]')!.click());
    expect(currentRoute.value.name).toBe('settings');
  });
});

describe('Settings entry', () => {
  it('has «Журнал ошибок» that opens the screen', async () => {
    const el = mount(<Settings />);
    await act(async () => btn(el, 'Журнал ошибок').click());
    expect(currentRoute.value.name).toBe('log');
  });
});
