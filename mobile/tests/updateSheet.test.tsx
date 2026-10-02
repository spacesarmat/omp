import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { UpdateSheet, setApkInstaller } from '../src/ui/UpdateSheet';
import { updatePrompt } from '../../src/store/updates';
import type { UpdateInfo } from '../../src/lib/updateInfo';

const HASH = 'a'.repeat(64);
const info: UpdateInfo = {
  version: '9.9.9',
  ipkUrl: 'https://example.com/omp.apk',
  ipkHash: HASH,
  ipkSize: 4404019,
  notes: ['Первое', 'Второе'],
  releaseUrl: 'https://example.com/r',
};

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  render(<UpdateSheet info={info} />, el);
  return el;
}
const btn = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t)!;

beforeEach(() => {
  localStorage.clear();
  updatePrompt.value = info;
  setApkInstaller(null);
});

describe('UpdateSheet', () => {
  it('shows version, size and notes', () => {
    const el = mount();
    expect(el.textContent).toContain('Доступна версия 9.9.9');
    expect(el.textContent).toContain('4,2 МБ');
    expect(el.querySelectorAll('li')).toHaveLength(2);
  });

  it('installs with url/sha256, shows progress, guards re-entry', async () => {
    let report: (p: number) => void = () => {};
    let finish: () => void = () => {};
    const calls: string[][] = [];
    setApkInstaller((url, sha, onProgress) => {
      calls.push([url, sha]);
      report = onProgress;
      return new Promise<void>((r) => (finish = r));
    });
    const el = mount();
    await act(async () => {
      const b = btn(el, 'Установить');
      b.click();
      b.click();
    });
    expect(calls).toEqual([[info.ipkUrl, HASH]]);
    await act(async () => report(150));
    expect(el.textContent).toContain('Скачивание… 100%');
    await act(async () => report(NaN));
    expect(el.textContent).toContain('Скачивание…');
    expect(el.textContent).not.toContain('%');
    await act(async () => report(64));
    expect(el.textContent).toContain('Скачивание… 64%');
    await act(async () => finish());
    expect(el.textContent).not.toContain('Скачивание…');
    expect(el.textContent).toContain('Запуск установки…');
  });

  it('shows installer error text', async () => {
    setApkInstaller(() => Promise.reject(new Error('Разрешите установку')));
    const el = mount();
    await act(async () => btn(el, 'Установить').click());
    await act(async () => {});
    expect(el.querySelector('.m-error')!.textContent).toContain('Разрешите установку');
    expect(btn(el, 'Установить')).toBeTruthy();
  });

  it('wraps non-Russian errors', async () => {
    setApkInstaller(() => Promise.reject(new Error('checksum mismatch')));
    const el = mount();
    await act(async () => btn(el, 'Установить').click());
    await act(async () => {});
    expect(el.querySelector('.m-error')!.textContent).toBe('Не удалось установить обновление: checksum mismatch');
  });

  it('skip writes skipped and closes the prompt', async () => {
    const el = mount();
    await act(async () => btn(el, 'Пропустить').click());
    expect(JSON.parse(localStorage.getItem('tsp.update')!).skipped).toBe('9.9.9');
    expect(updatePrompt.value).toBeNull();
  });

  it('later dismisses the prompt', async () => {
    const el = mount();
    await act(async () => btn(el, 'Позже').click());
    expect(updatePrompt.value).toBeNull();
  });
});
