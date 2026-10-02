import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Settings, setUpdateChecker } from '../src/screens/Settings';
import { currentRoute, resetTo } from '../src/nav';
import { settings, updateSettings } from '../../src/store/settings';
import { addServer, setActiveServer, removeServer, servers } from '../../src/store/servers';
import { ANDROID_UPDATE_URL } from '../../src/lib/updateInfo';
import { APP_VERSION } from '../../src/version';
import { toast } from '../src/ui/toast';

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  render(<Settings />, el);
  return el;
}
const btn = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t)!;

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  updateSettings({ updateCheck: true });
  toast.value = '';
  setUpdateChecker(null);
  resetTo({ name: 'settings' });
});

describe('Settings', () => {
  it('shows version, server and navigates', async () => {
    const s = addServer({ url: 'http://192.168.1.5:8090', name: 'Home' });
    setActiveServer(s.id);
    const el = mount();
    expect(el.textContent).toContain(APP_VERSION);
    expect(el.textContent).toContain('Home');
    await act(async () => btn(el, 'Сменить').click());
    expect(currentRoute.value.name).toBe('connect');
    resetTo({ name: 'settings' });
    await act(async () => btn(el, 'Выбрать').click());
    expect(currentRoute.value.name).toBe('tv');
  });

  it('manual check uses the Android feed and toasts the result', async () => {
    const urls: (string | undefined)[] = [];
    const manual: boolean[] = [];
    setUpdateChecker(async (o) => {
      urls.push(o.url);
      manual.push(o.manual);
      return 'latest';
    });
    const el = mount();
    await act(async () => btn(el, 'Проверить обновления').click());
    await act(async () => {});
    expect(urls).toEqual([ANDROID_UPDATE_URL]);
    expect(manual).toEqual([true]);
    expect(toast.value).toBe('У вас последняя версия');
    setUpdateChecker(async () => 'error');
    await act(async () => btn(el, 'Проверить обновления').click());
    await act(async () => {});
    expect(toast.value).toBe('Не удалось проверить обновления');
  });

  it('toggles check on start', async () => {
    const el = mount();
    const sw = el.querySelector<HTMLElement>('[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await act(async () => sw.click());
    expect(settings.value.updateCheck).toBe(false);
  });

  it('opens the project page externally', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const el = mount();
    await act(async () => btn(el, 'Страница проекта').click());
    expect(open).toHaveBeenCalledWith('https://github.com/spacesarmat/omp', '_system');
    open.mockRestore();
  });
});
