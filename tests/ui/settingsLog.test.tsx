import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SettingsScreen } from '../../src/screens/Settings';
import { log, clearLog, logEntries } from '../../src/lib/log';

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(SettingsScreen, {}), host));
  return host;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
afterEach(() => {
  clearLog();
  Array.from(document.body.children).forEach((c) => render(null, c));
  document.body.innerHTML = '';
});

describe('TV Settings: brief log', () => {
  it('shows an empty state', () => {
    clearLog();
    const host = mount();
    expect(host.textContent).toContain('Журнал');
    expect(host.textContent).toContain('Записей нет');
  });
  it('lists the last 20 entries newest first with level, time and area', () => {
    clearLog();
    for (let i = 0; i < 25; i++) log('error', 'search', 'сбой ' + i);
    const host = mount();
    const lines = Array.from(host.querySelectorAll('.log-line')).map((n) => n.textContent!);
    expect(lines.length).toBe(20);
    expect(lines[0]).toMatch(/^ОШИБКА \d\d:\d\d:\d\d · поиск: сбой 24$/);
    expect(lines[19]).toContain('сбой 5');
    expect(logEntries().length).toBe(25);
  });
  it('has a clear button', () => {
    log('error', 'app', 'x');
    const host = mount();
    expect(Array.from(host.querySelectorAll('button, [role=button], .btn')).some((b) => b.textContent!.includes('Очистить журнал')) || host.textContent!.includes('Очистить журнал')).toBe(true);
  });
});
