import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SettingsScreen } from '../../src/screens/Settings';

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
