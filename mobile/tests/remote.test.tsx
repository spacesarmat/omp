import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Remote, setRemoteActions } from '../src/screens/Remote';
import { currentRoute, resetTo } from '../src/nav';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';

let el: HTMLElement;
const a = {
  pressButton: vi.fn(),
  moveCursor: vi.fn(),
  click: vi.fn(),
  volume: vi.fn(),
  typeText: vi.fn(),
  deleteText: vi.fn(),
  sendEnter: vi.fn(),
  turnOffTv: vi.fn(),
  confirm: vi.fn(),
};

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Remote />, el));
}
const lbl = (l: string) => el.querySelector(`[aria-label="${l}"]`) as HTMLElement;
const click = (n: Element) => act(() => (n as HTMLElement).click());
const text = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t))!;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });

function ptr(n: Element, type: string, x: number, y: number) {
  const e = new Event(type, { bubbles: true }) as any;
  e.pointerId = 1;
  e.clientX = x;
  e.clientY = y;
  act(() => {
    n.dispatchEvent(e);
  });
}

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  for (const f of Object.values(a)) f.mockReset().mockResolvedValue(undefined);
  a.confirm.mockReturnValue(true);
  setRemoteActions(a);
  toast.value = '';
  resetTo({ name: 'remote' });
});

afterEach(() => {
  act(() => render(null, el));
  setRemoteActions(null);
  vi.useRealTimers();
});

describe('Remote without a TV', () => {
  it('shows the placeholder and leads to the TV screen', () => {
    mount();
    expect(el.textContent).toContain('Подключите телевизор');
    click(text('Подключить ТВ'));
    expect(currentRoute.value).toEqual({ name: 'tv' });
  });
});

describe('Remote with a TV', () => {
  beforeEach(() => saveTv({ ip: '192.168.1.5', name: 'LG OLED' }));

  it('d-pad and keys map to buttons', () => {
    mount();
    expect(el.textContent).toContain('LG OLED');
    click(lbl('Вверх'));
    expect(a.pressButton).toHaveBeenLastCalledWith('UP');
    click(text('OK'));
    expect(a.pressButton).toHaveBeenLastCalledWith('ENTER');
    click(lbl('Домой'));
    expect(a.pressButton).toHaveBeenLastCalledWith('HOME');
  });

  it('media row mapping and play/pause toggle', async () => {
    mount();
    click(lbl('Назад на 10 с'));
    expect(a.pressButton).toHaveBeenLastCalledWith('REWIND');
    click(lbl('Пред. серия'));
    expect(a.pressButton).toHaveBeenLastCalledWith('CHANNELDOWN');
    click(lbl('След. серия'));
    expect(a.pressButton).toHaveBeenLastCalledWith('CHANNELUP');
    click(lbl('Вперёд на 10 с'));
    expect(a.pressButton).toHaveBeenLastCalledWith('FASTFORWARD');
    click(lbl('Пауза'));
    expect(a.pressButton).toHaveBeenLastCalledWith('PAUSE');
    await flush();
    click(lbl('Воспроизвести'));
    expect(a.pressButton).toHaveBeenLastCalledWith('PLAY');
  });

  it('volume buttons', () => {
    mount();
    click(lbl('Громче'));
    click(lbl('Тише'));
    expect(a.volume.mock.calls).toEqual([['up'], ['down']]);
  });

  describe('keyboard', () => {
    const open = () => {
      mount();
      click(lbl('Клавиатура'));
      return el.querySelector('input[aria-label="Ввод на телевизоре"]') as HTMLInputElement;
    };
    const edit = async (i: HTMLInputElement, v: string, init: InputEventInit = {}) => {
      act(() => {
        i.value = v;
        i.dispatchEvent(new InputEvent('input', { bubbles: true, ...init }));
      });
      await flush();
    };

    it('types appended text and deletes at the end', async () => {
      const i = open();
      await edit(i, 'ab');
      expect(a.typeText).toHaveBeenCalledWith('ab');
      await edit(i, 'a');
      expect(a.deleteText).toHaveBeenCalledWith(1);
      expect(a.typeText).toHaveBeenCalledTimes(1);
    });

    it('mid-string insert rewrites from the common prefix', async () => {
      const i = open();
      await edit(i, 'abcd');
      a.typeText.mockClear();
      await edit(i, 'abXcd');
      expect(a.deleteText).toHaveBeenLastCalledWith(2);
      expect(a.typeText).toHaveBeenLastCalledWith('Xcd');
    });

    it('same-length replacement (autocorrect) is a delete plus a type', async () => {
      const i = open();
      await edit(i, 'teh');
      await edit(i, 'the');
      expect(a.deleteText).toHaveBeenLastCalledWith(2);
      expect(a.typeText).toHaveBeenLastCalledWith('he');
    });

    it('paste over a selection', async () => {
      const i = open();
      await edit(i, 'hello world');
      await edit(i, 'hello there');
      expect(a.deleteText).toHaveBeenLastCalledWith(5);
      expect(a.typeText).toHaveBeenLastCalledWith('there');
    });

    it('composition sends once, at the end', async () => {
      const i = open();
      act(() => {
        i.dispatchEvent(new Event('compositionstart', { bubbles: true }));
      });
      await edit(i, 'п', { isComposing: true });
      await edit(i, 'пр', { isComposing: true });
      expect(a.typeText).not.toHaveBeenCalled();
      act(() => {
        i.value = 'привет';
        i.dispatchEvent(new Event('compositionend', { bubbles: true }));
      });
      await flush();
      expect(a.typeText).toHaveBeenCalledTimes(1);
      expect(a.typeText).toHaveBeenCalledWith('привет');
    });

    it('Enter sends enter and clears the field and the sent text', async () => {
      const i = open();
      await edit(i, 'abc');
      act(() => {
        i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      await flush();
      expect(a.sendEnter).toHaveBeenCalled();
      expect(i.value).toBe('');
      a.deleteText.mockClear();
      await edit(i, 'x');
      expect(a.deleteText).not.toHaveBeenCalled();
      expect(a.typeText).toHaveBeenLastCalledWith('x');
    });
  });

  it('power asks to confirm and then toasts', async () => {
    mount();
    a.confirm.mockReturnValueOnce(false);
    click(lbl('Выключить телевизор'));
    await flush();
    expect(a.turnOffTv).not.toHaveBeenCalled();
    click(lbl('Выключить телевизор'));
    await flush();
    expect(a.turnOffTv).toHaveBeenCalled();
    expect(toast.value).toBe('Телевизор выключается');
  });

  it('touchpad: tap clicks, drag moves with throttle', () => {
    vi.useFakeTimers();
    mount();
    click(text('Тачпад'));
    const pad = el.querySelector('.m-touchpad')!;
    ptr(pad, 'pointerdown', 100, 100);
    ptr(pad, 'pointerup', 100, 100);
    expect(a.click).toHaveBeenCalledTimes(1);

    ptr(pad, 'pointerdown', 100, 100);
    vi.setSystemTime(Date.now() + 100);
    ptr(pad, 'pointermove', 120, 110);
    expect(a.moveCursor).toHaveBeenLastCalledWith(20, 10);
    vi.setSystemTime(Date.now() + 10);
    ptr(pad, 'pointermove', 130, 115);
    expect(a.moveCursor).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 40);
    ptr(pad, 'pointermove', 140, 120);
    expect(a.moveCursor).toHaveBeenCalledTimes(2);
    expect(a.moveCursor).toHaveBeenLastCalledWith(20, 10);
    ptr(pad, 'pointerup', 140, 120);
    expect(a.click).toHaveBeenCalledTimes(1);
  });

  it('touchpad ignores a second pointer', () => {
    mount();
    click(text('Тачпад'));
    const pad = el.querySelector('.m-touchpad')!;
    ptr(pad, 'pointerdown', 100, 100);
    const e = new Event('pointerup', { bubbles: true }) as any;
    e.pointerId = 2;
    act(() => {
      pad.dispatchEvent(e);
    });
    expect(a.click).not.toHaveBeenCalled();
    ptr(pad, 'pointerup', 100, 100);
    expect(a.click).toHaveBeenCalledTimes(1);
  });

  it('play/pause label stays when the press fails', async () => {
    mount();
    a.pressButton.mockRejectedValueOnce(new Error('нет связи'));
    click(lbl('Пауза'));
    await flush();
    expect(lbl('Пауза')).toBeTruthy();
    expect(toast.value).toBe('нет связи');
  });
});
