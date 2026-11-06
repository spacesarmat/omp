import { h, render } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import { lazyScreen } from '../src/lib/lazyScreen';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('lazyScreen', () => {
  it('shows a load failure and retries after the user asks', async () => {
    const first = deferred<Record<string, () => h.JSX.Element>>();
    const second = deferred<Record<string, () => h.JSX.Element>>();
    let calls = 0;
    const Screen = lazyScreen(() => {
      calls++;
      return calls === 1 ? first.promise : second.promise;
    }, 'Missing');
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(<Screen />, host);
    await vi.waitFor(() => expect(calls).toBe(1));
    first.reject(new Error('offline'));
    await vi.waitFor(() => expect(host.textContent).toContain('Не удалось открыть экран'));
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('Повторить');
    second.resolve({ Missing: () => <div>Готово</div> });
    button.click();
    await vi.waitFor(() => expect(host.textContent).toBe('Готово'));
    expect(calls).toBe(2);
    host.remove();
  });
});
