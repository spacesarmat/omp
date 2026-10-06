import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App, handleBack } from '../src/app';
import { setUpdateChecker } from '../src/screens/Settings';
import { currentRoute, resetTo } from '../src/nav';
import { updatePrompt, latestUpdate, CHECK_INTERVAL_MS } from '../../src/store/updates';
import { ANDROID_UPDATE_URL, type UpdateInfo } from '../../src/lib/updateInfo';

const info: UpdateInfo = {
  version: '9.9.9',
  ipkUrl: 'https://example.com/omp.apk',
  ipkHash: 'a'.repeat(64),
  ipkSize: 0,
  notes: [],
  releaseUrl: 'https://example.com/r',
};

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  render(<App />, el);
  return el;
}

beforeEach(() => {
  localStorage.clear();
  updatePrompt.value = null;
  latestUpdate.value = null;
});
afterEach(() => {
  // unmount: an App left mounted keeps its listeners (the return-to-OMP check) into the next test
  const el = document.getElementById('app');
  if (el) render(null, el);
  vi.useRealTimers();
  setUpdateChecker(null);
});

describe('app update wiring', () => {
  it('schedules exactly one background check after 3 s', async () => {
    vi.useFakeTimers();
    const urls: (string | undefined)[] = [];
    setUpdateChecker(async (o) => {
      urls.push(o.url);
      return 'latest';
    });
    resetTo({ name: 'library' });
    mount();
    await act(async () => {
      vi.advanceTimersByTime(2900);
    });
    expect(urls).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(urls).toEqual([ANDROID_UPDATE_URL]);
  });

  it('the launch check has no interval; a return to OMP checks again with the hourly one', async () => {
    vi.useFakeTimers();
    const gaps: (number | undefined)[] = [];
    setUpdateChecker(async (o) => {
      gaps.push(o.minIntervalMs);
      return 'latest';
    });
    resetTo({ name: 'library' });
    mount();
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(gaps).toEqual([0, CHECK_INTERVAL_MS]);
  });

  it('a found update puts a dot on «Настройки» until it is installed', async () => {
    resetTo({ name: 'library' });
    const el = mount();
    expect(el.querySelector('.m-nav-dot')).toBeNull();
    await act(async () => {
      latestUpdate.value = info;
    });
    const settingsTab = Array.from(el.querySelectorAll('.m-nav-item')).find((b) => b.textContent!.includes('Настройки'))!;
    expect(settingsTab.querySelector('.m-nav-dot')).not.toBeNull();
  });

  it('shows the sheet only on tab routes; Back dismisses it', async () => {
    resetTo({ name: 'connect' });
    updatePrompt.value = info;
    const el = mount();
    expect(el.querySelector('.m-sheet-host')).toBeNull();
    await act(async () => resetTo({ name: 'library' }));
    expect(el.querySelector('.m-sheet-host')).not.toBeNull();
    await act(async () => handleBack());
    expect(updatePrompt.value).toBeNull();
    expect(currentRoute.value.name).toBe('library');
    expect(el.querySelector('.m-sheet-host')).toBeNull();
  });
});
