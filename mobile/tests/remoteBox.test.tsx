import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Remote, setRemoteActions } from '../src/screens/Remote';
import { resetTo } from '../src/nav';
import { reloadTvs, saveTv, tvs } from '../src/tv/tvStore';
import { tvState } from '../src/tv/tvClient';
import { toast } from '../src/ui/toast';
import { BOX, BoxError, boxState, setBoxNative } from '../src/tv/boxRemote';

const IP = '192.168.1.106';
let el: HTMLElement;
const a = {
  pressButton: vi.fn(),
  volume: vi.fn(),
  typeText: vi.fn(),
  deleteText: vi.fn(),
  sendEnter: vi.fn(),
  pressAtvKey: vi.fn(),
  pairAtv: vi.fn(),
  warmUp: vi.fn(),
  switchTv: vi.fn(),
};

function fakeNative(over: Record<string, unknown> = {}) {
  const n: Record<string, any> = {
    available: true,
    probe: vi.fn().mockResolvedValue({ google: true, adb: true }),
    connect: vi.fn().mockImplementation((_ip: string, v: 'google' | 'adb') => Promise.resolve(v)),
    pairStart: vi.fn().mockResolvedValue(undefined),
    pairFinish: vi.fn().mockResolvedValue('google'),
    pairCancel: vi.fn().mockResolvedValue(undefined),
    key: vi.fn().mockResolvedValue(undefined),
    text: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onClosed: vi.fn(() => () => {}),
    ...over,
  };
  return n as any;
}

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Remote />, el));
}
const lbl = (l: string) => el.querySelector(`[aria-label="${l}"]`) as HTMLElement;
const click = (n: Element) => act(() => (n as HTMLElement).click());
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const sw = () => el.querySelector('[data-box-row] [role=switch]') as HTMLElement;
const status = () => el.querySelector('[data-box-status]')!.textContent;

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  for (const f of Object.values(a)) f.mockReset().mockResolvedValue(undefined);
  setRemoteActions(a);
  toast.value = '';
  resetTo({ name: 'remote' });
  saveTv({ ip: IP, name: 'Dune HD', kind: 'atv', token: 'a'.repeat(32) });
});

afterEach(() => {
  act(() => render(null, el));
  setRemoteActions(null);
  setBoxNative(null);
  tvState.value = 'idle';
});

describe('«Управлять приставкой»', () => {
  it('off: keys go to OMP, «Домой» opens the catalog, no box-only keys', () => {
    setBoxNative(fakeNative());
    mount();
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(status()).toContain('не только OMP');
    click(lbl('Вверх'));
    click(lbl('Домой'));
    click(lbl('Громче'));
    expect(a.pressButton.mock.calls).toEqual([['UP']]);
    expect(a.pressAtvKey.mock.calls).toEqual([['CATALOG']]);
    expect(a.volume.mock.calls).toEqual([['up']]);
    expect(lbl('Настройки')).toBeNull();
    expect(lbl('Без звука')).toBeNull();
  });

  it('on and connected over Google TV Remote: every key goes to the box, Settings / mute / media keys appear', async () => {
    const n = fakeNative();
    setBoxNative(n);
    mount();
    click(sw());
    await flush();
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(status()).toBe('через Google TV Remote');
    for (const l of ['Вверх', 'OK', 'Назад', 'Домой', 'Меню', 'Громче', 'Тише', 'Без звука', 'Настройки', 'Пауза / воспроизведение', 'Следующий', 'Предыдущий', 'Красная кнопка']) {
      click(l === 'OK' ? el.querySelector('.m-dpad-ok')! : lbl(l));
    }
    await flush();
    expect(n.key.mock.calls.map((c: unknown[]) => c[0])).toEqual([19, 23, 4, 3, 82, 24, 25, 164, 176, 85, 87, 88, 183]);
    expect(a.pressButton).not.toHaveBeenCalled();
    expect(a.volume).not.toHaveBeenCalled();
    expect(a.pressAtvKey).not.toHaveBeenCalled();
    // «Сейчас играет» stays OMP's
    click(lbl('Сейчас играет'));
    expect(a.pressAtvKey.mock.calls).toEqual([['NOWPLAYING']]);
    expect(tvs.value[0].box).toEqual({ on: true, via: 'google' });
  });

  it('pairing: the code sheet, a wrong code shows the error, the right one connects', async () => {
    const n = fakeNative({
      connect: vi.fn().mockRejectedValueOnce(new BoxError(BOX.NEED_PAIRING)).mockResolvedValue('google'),
      pairFinish: vi.fn().mockRejectedValueOnce(new BoxError(BOX.BAD_CODE)).mockResolvedValueOnce('google'),
    });
    setBoxNative(n);
    mount();
    click(sw());
    await flush();
    expect(status()).toBe('введите код с ТВ');
    const form = el.querySelector('[data-box-code]') as HTMLFormElement;
    expect(form.textContent).toContain('Введите код с экрана телевизора');
    const input = lbl('Код с экрана телевизора') as HTMLInputElement;
    const submit = form.querySelector('button[type=submit]') as HTMLButtonElement;
    act(() => {
      input.value = 'a1b2c';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(submit.disabled).toBe(true);
    act(() => {
      input.value = 'a1b2c9';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('A1B2C9');
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(form.querySelector('[role=alert]')!.textContent).toBe('Код неверный — проверьте код на экране телевизора');
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(el.querySelector('[data-box-code]')).toBeNull();
    expect(status()).toBe('через Google TV Remote');
  });

  it('adb: asks to confirm on the TV, then «через отладку по сети»', async () => {
    let resolve!: (v: 'adb') => void;
    setBoxNative(
      fakeNative({
        probe: vi.fn().mockResolvedValue({ google: false, adb: true }),
        connect: vi.fn().mockImplementation(() => new Promise((r) => (resolve = r))),
      }),
    );
    mount();
    click(sw());
    await flush();
    expect(status()).toBe('подтвердите на ТВ');
    expect(el.textContent).toContain('Всегда разрешать');
    await act(async () => {
      resolve('adb');
    });
    await flush();
    expect(status()).toBe('через отладку по сети');
  });

  it('nothing answers: the network debugging instructions and «Проверить снова»', async () => {
    const n = fakeNative({ probe: vi.fn().mockResolvedValue({ google: false, adb: false }) });
    setBoxNative(n);
    mount();
    click(sw());
    await flush();
    const problem = el.querySelector('[data-box-problem]')!;
    expect(problem.textContent).toContain('Настройки → Об устройстве → 7 раз «Сборка» → Для разработчиков → Отладка по сети');
    n.probe.mockResolvedValue({ google: false, adb: true });
    click(Array.from(problem.querySelectorAll('button')).find((b) => b.textContent === 'Проверить снова')!);
    await flush();
    expect(status()).toBe('через отладку по сети');
  });

  it('errors are named: declined on the TV, the box does not answer', async () => {
    const n = fakeNative({ connect: vi.fn().mockRejectedValue(new BoxError(BOX.REJECTED)) });
    setBoxNative(n);
    mount();
    click(sw());
    await flush();
    expect(el.querySelector('[data-box-problem]')!.textContent).toContain('Подключение отклонено на телевизоре');
    n.probe.mockRejectedValue(new BoxError(BOX.UNREACHABLE));
    click(lbl('Управлять приставкой'));
    click(lbl('Управлять приставкой'));
    await flush();
    expect(el.querySelector('[data-box-problem]')!.textContent).toContain('Приставка не отвечает');
  });

  it('a switched-on box reconnects when the remote opens; switching off sends keys to OMP again', async () => {
    saveTv({ ip: IP, name: 'Dune HD', kind: 'atv', box: { on: true, via: 'adb' } });
    const n = fakeNative();
    setBoxNative(n);
    mount();
    await flush();
    expect(n.connect).toHaveBeenCalledWith(IP, 'adb');
    expect(boxState.value).toBe('connected');
    click(sw());
    expect(n.disconnect).toHaveBeenCalled();
    click(lbl('Домой'));
    expect(a.pressAtvKey.mock.calls).toEqual([['CATALOG']]);
  });
});
