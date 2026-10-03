import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Monitor } from '../src/screens/Monitor';
import { Settings } from '../src/screens/Settings';
import { currentRoute, resetTo } from '../src/nav';
import { fakeMonitor, type FakeMonitor } from './fakeMonitor';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { loadMonitorSettings, saveLastRun, saveMonitorSettings } from '../../src/monitor/settings';

let el: HTMLElement;
let mon: FakeMonitor;

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const sw = (label: string) => el.querySelector('[role=switch][aria-label="' + label + '"]') as HTMLElement;
const click = (n: Element | undefined | null) => {
  if (!n) throw new Error('missing element');
  act(() => (n as HTMLElement).click());
};

async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => render(<Monitor />, el));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  resetTo({ name: 'settings' });
  mon = fakeMonitor();
});

afterEach(() => {
  if (el) act(() => render(null, el));
  mon.restore();
  vi.restoreAllMocks();
});

describe('«Мониторинг»', () => {
  it('shows the defaults: on, every 3 hours, Wi-Fi only, new episodes', async () => {
    await mount();
    expect(sw('Проверять в фоне').getAttribute('aria-checked')).toBe('true');
    expect(sw('Только через Wi-Fi').getAttribute('aria-checked')).toBe('true');
    expect(sw('Следить за новыми сериями').getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).toContain('раз в 3 часа ›');
    expect(el.textContent).toContain('Проверок ещё не было');
    expect(el.textContent).toContain('Android может откладывать фоновые проверки ради батареи');
  });

  it('switches save and reschedule; switching on asks for notifications once', async () => {
    saveMonitorSettings({ enabled: false });
    await mount();
    click(sw('Только через Wi-Fi'));
    expect(loadMonitorSettings().wifiOnly).toBe(false);
    expect(mon.schedule).toHaveBeenLastCalledWith({ enabled: false, hours: 3, wifiOnly: false });
    click(sw('Проверять в фоне'));
    await flush();
    expect(mon.schedule).toHaveBeenLastCalledWith({ enabled: true, hours: 3, wifiOnly: false });
    expect(mon.requestNotifyPermission).toHaveBeenCalledTimes(1);
    click(sw('Проверять в фоне'));
    click(sw('Проверять в фоне'));
    await flush();
    expect(mon.requestNotifyPermission).toHaveBeenCalledTimes(1);
    // new episodes do not change the schedule
    const calls = mon.schedule.mock.calls.length;
    click(sw('Следить за новыми сериями'));
    expect(loadMonitorSettings().episodes).toBe(false);
    expect(mon.schedule.mock.calls.length).toBe(calls);
  });

  it('«Как часто» picks 1 / 3 / 6 / 12 hours', async () => {
    await mount();
    click(Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').startsWith('Как часто')));
    const opts = Array.from(el.querySelectorAll('[role=radio]')).map((b) => b.textContent);
    expect(opts).toEqual(['раз в час', 'раз в 3 часа', 'раз в 6 часов', 'раз в 12 часов']);
    click(Array.from(el.querySelectorAll('[role=radio]')).find((b) => b.textContent === 'раз в 6 часов'));
    expect(loadMonitorSettings().hours).toBe(6);
    expect(mon.schedule).toHaveBeenLastCalledWith({ enabled: true, hours: 6, wifiOnly: true });
    expect(el.textContent).toContain('раз в 6 часов ›');
  });

  it('the last check: time, found, sources, blocked notifications; the next one', async () => {
    const now = Date.now();
    saveLastRun({ at: now - 1000, kind: 'check', found: 3, notified: 0, answered: 7, asked: 8, subs: 2, skipped: 0, feed: true, notifyBlocked: true });
    mon.status = { enabled: true, hours: 3, wifiOnly: true, running: false, nextRun: now + 7200000 };
    mon.permission = 'denied';
    await mount();
    const box = el.querySelector('[data-last-check]')!.textContent!;
    expect(box).toMatch(/Последняя проверка: сегодня \d\d:\d\d/);
    expect(box).toContain('Найдено новых: 3');
    expect(box).toContain('Источники: 7 из 8 ответили');
    expect(box).toContain('Уведомления не показаны');
    expect(box).toMatch(/Следующая проверка около /);
    expect(el.textContent).toContain('Уведомления для OMP выключены');
  });

  it('the permission can be asked from the screen when it was never decided', async () => {
    mon.permission = 'prompt';
    await mount();
    click(Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Разрешить уведомления'));
    await flush();
    expect(mon.requestNotifyPermission).toHaveBeenCalled();
    expect(el.textContent).not.toContain('Уведомления для OMP выключены');
  });

  it('Settings has the «Мониторинг» row', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    act(() => render(<Settings />, el));
    const row = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').startsWith('Мониторинг'))!;
    expect(row.textContent).toContain('раз в 3 часа');
    click(row);
    expect(currentRoute.value.name).toBe('monitor');
  });
});
