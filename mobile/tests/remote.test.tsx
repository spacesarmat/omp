import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Remote, setRemoteActions, shortTvName } from '../src/screens/Remote';
import { currentRoute, resetTo } from '../src/nav';
import { reloadTvs, saveTv, setActiveTv } from '../src/tv/tvStore';
import { tvWaking, tvState, tvError, tvForgot } from '../src/tv/tvClient';
import { toast } from '../src/ui/toast';
import { nowPlaying, lastSeen } from '../src/tv/playerLink';
import { reloadTouchpad, updateTouchpad, touchpad, cursorGain, sanitizeTouchpad, TOUCHPAD_DEFAULTS } from '../src/tv/touchpad';

let el: HTMLElement;
const a = {
  pressButton: vi.fn(),
  moveCursor: vi.fn(),
  click: vi.fn(),
  scroll: vi.fn(),
  volume: vi.fn(),
  typeText: vi.fn(),
  deleteText: vi.fn(),
  sendEnter: vi.fn(),
  turnOffTv: vi.fn(),
  pressAtvKey: vi.fn(),
  wakeOnLan: vi.fn(),
  pairAtv: vi.fn(),
  warmUp: vi.fn(),
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
  reloadTouchpad();
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

describe('Remote header and layout', () => {
  it('shortTvName drops «[LG] » and «webOS TV »', () => {
    expect(shortTvName('[LG] webOS TV OLED55C9PLA')).toBe('OLED55C9PLA');
    expect(shortTvName('webOS TV UN43')).toBe('UN43');
    expect(shortTvName('Гостиная')).toBe('Гостиная');
    expect(shortTvName('[LG] webOS TV ')).toBe('[LG] webOS TV ');
  });

  it('the no-TV state has the tab header', () => {
    mount();
    expect(el.querySelector('.m-screen-head h1')!.textContent).toBe('Пульт');
  });

  it('the tab header: «Пульт», the short TV name with its state, the full name as the title', () => {
    saveTv({ ip: '192.168.1.5', name: '[LG] webOS TV OLED55C9PLA' });
    mount();
    expect(el.querySelector('.m-screen-head h1')!.textContent).toBe('Пульт');
    const sub = el.querySelector('.m-screen-head .m-head-sub')!;
    expect(sub.textContent).toBe('OLED55C9PLA · Не подключён');
    expect(sub.querySelector('[title]')!.getAttribute('title')).toBe('[LG] webOS TV OLED55C9PLA');
    act(() => {
      tvState.value = 'connected';
    });
    expect(sub.querySelector('.m-remote-state.on')!.textContent).toBe('Подключён');
    expect(el.querySelector('.m-screen-head [aria-label="Настройки тачпада"]')).toBeTruthy();
    expect(el.querySelector('.m-screen-head .m-power')).toBeTruthy();
    act(() => {
      tvState.value = 'idle';
    });
  });

  it('buttons mode: side keys around the d-pad, Home/Menu, the media row', () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    mount();
    const sides = Array.from(el.querySelectorAll('.m-rb-top .m-side'));
    expect(sides.length).toBe(2);
    expect(Array.from(sides[0].querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual(['Клавиатура', 'Назад']);
    expect(Array.from(sides[1].querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual(['Громче', 'Тише']);
    expect(el.querySelector('.m-rb-top .m-dpad-wrap')).toBeTruthy();
    expect(Array.from(el.querySelectorAll('.m-rb-two button')).map((b) => b.getAttribute('aria-label'))).toEqual(['Домой', 'Меню']);
    expect(el.querySelectorAll('.m-rb-media button').length).toBe(5);
    click(lbl('Громче'));
    expect(a.volume).toHaveBeenLastCalledWith('up');
    click(lbl('Назад'));
    expect(a.pressButton).toHaveBeenLastCalledWith('BACK');
    click(lbl('Клавиатура'));
    expect(el.querySelector('input[aria-label="Ввод на телевизоре"]')).toBeTruthy();
  });

  it('touchpad mode: the pad, then Back/Home/Menu/Keyboard, the media row and the volume bar', () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    mount();
    click(text('Тачпад'));
    expect(el.querySelector('.m-rt > .m-touchpad')).toBeTruthy();
    expect(Array.from(el.querySelectorAll('.m-rt-keys button')).map((b) => b.getAttribute('aria-label'))).toEqual(['Назад', 'Домой', 'Меню', 'Клавиатура']);
    expect(el.querySelectorAll('.m-rt .m-rb-media button').length).toBe(5);
    expect(el.querySelector('.m-rt-vol')!.textContent).toBe('−Громкость+');
    click(lbl('Тише'));
    expect(a.volume).toHaveBeenLastCalledWith('down');
  });
});

describe('Remote with a TV', () => {
  beforeEach(() => saveTv({ ip: '192.168.1.5', name: 'LG OLED' }));

  it('warms up the connection on mount and shows «Подключение…» while waking', () => {
    mount();
    expect(a.warmUp).toHaveBeenCalledTimes(1);
    act(() => {
      tvWaking.value = true;
    });
    expect(el.querySelector('.m-remote-state')!.textContent).toBe('Подключение…');
    act(() => {
      tvWaking.value = false;
    });
  });

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

    it('Enter and Backspace-on-empty wait for queued typing', async () => {
      const order: string[] = [];
      a.typeText.mockImplementation(async (t: string) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push('type:' + t);
      });
      a.sendEnter.mockImplementation(async () => void order.push('enter'));
      a.deleteText.mockImplementation(async (n: number) => void order.push('del:' + n));
      const i = open();
      act(() => {
        i.value = 'a';
        i.dispatchEvent(new InputEvent('input', { bubbles: true }));
        i.value = 'ab';
        i.dispatchEvent(new InputEvent('input', { bubbles: true }));
        i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });
      expect(order).toEqual(['type:a', 'type:b', 'enter', 'del:1']);
    });
  });

  it('power asks to confirm and then toasts', async () => {
    tvState.value = 'connected';
    mount();
    a.confirm.mockReturnValueOnce(false);
    click(lbl('Выключить телевизор'));
    await flush();
    expect(a.turnOffTv).not.toHaveBeenCalled();
    click(lbl('Выключить телевизор'));
    await flush();
    expect(a.turnOffTv).toHaveBeenCalled();
    expect(toast.value).toBe('Телевизор выключается');
    tvState.value = 'idle';
  });

  describe('power button modes', () => {
    it('is «Выключить» while connected', () => {
      act(() => {
        tvState.value = 'connected';
      });
      mount();
      expect(lbl('Выключить телевизор')).toBeTruthy();
      expect(lbl('Включить телевизор')).toBeNull();
      act(() => {
        tvState.value = 'idle';
      });
    });

    it('is a disabled «Выключить» while pairing', async () => {
      saveTv({ ip: '192.168.1.5', name: 'LG OLED', mac: 'aa:bb:cc:dd:ee:ff' });
      act(() => {
        tvState.value = 'pairing';
      });
      mount();
      const b = lbl('Выключить телевизор') as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.classList.contains('on')).toBe(false);
      expect(lbl('Включить телевизор')).toBeNull();
      click(b);
      await flush();
      expect(a.wakeOnLan).not.toHaveBeenCalled();
      expect(a.confirm).not.toHaveBeenCalled();
      act(() => {
        tvState.value = 'idle';
      });
    });

    it('is a green «Включить» with a known MAC: sends WoL, toasts, then warms up', async () => {
      saveTv({ ip: '192.168.1.5', name: 'LG OLED', mac: 'aa:bb:cc:dd:ee:ff' });
      mount();
      a.warmUp.mockClear();
      const b = lbl('Включить телевизор');
      expect(b.classList.contains('on')).toBe(true);
      click(b);
      await flush();
      expect(a.wakeOnLan).toHaveBeenCalledWith('aa:bb:cc:dd:ee:ff', '192.168.1.5');
      expect(toast.value).toBe('Включаю LG OLED…');
      expect(a.warmUp).toHaveBeenCalledTimes(1);
      expect(a.confirm).not.toHaveBeenCalled();
    });

    it('explains how to learn the MAC when it is unknown', async () => {
      mount();
      const b = lbl('Включить телевизор');
      expect(b.classList.contains('on')).toBe(false);
      click(b);
      await flush();
      expect(a.wakeOnLan).not.toHaveBeenCalled();
      expect(toast.value).toContain('Подключитесь к телевизору, когда он включён');
    });

    it('shows a WoL failure and does not warm up', async () => {
      saveTv({ ip: '192.168.1.5', name: 'LG OLED', mac: 'aa:bb:cc:dd:ee:ff' });
      mount();
      a.warmUp.mockClear();
      a.wakeOnLan.mockRejectedValueOnce(new Error('нет сети'));
      click(lbl('Включить телевизор'));
      await flush();
      expect(toast.value).toBe('нет сети');
      expect(a.warmUp).not.toHaveBeenCalled();
    });
  });

  it('touchpad: tap clicks, drag moves with throttle', () => {
    vi.useFakeTimers();
    updateTouchpad({ accel: false });
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

  it('touchpad: the speed step scales the move and a fast flick accelerates it', () => {
    vi.useFakeTimers();
    updateTouchpad({ accel: false, speed: 5 });
    mount();
    click(text('Тачпад'));
    const pad = el.querySelector('.m-touchpad')!;
    ptr(pad, 'pointerdown', 100, 100);
    vi.setSystemTime(Date.now() + 100);
    ptr(pad, 'pointermove', 120, 100);
    expect(a.moveCursor).toHaveBeenLastCalledWith(38, 0);
    ptr(pad, 'pointerup', 120, 100);
    updateTouchpad({ accel: true, speed: 3 });
    ptr(pad, 'pointerdown', 100, 100);
    vi.setSystemTime(Date.now() + 10);
    ptr(pad, 'pointermove', 120, 100);
    expect(a.moveCursor).toHaveBeenLastCalledWith(50, 0); // 2 px/ms: x2.5 (capped)
  });

  it('touchpad: a tap does nothing when «Касание = щелчок» is off', () => {
    updateTouchpad({ tapClick: false });
    mount();
    click(text('Тачпад'));
    const pad = el.querySelector('.m-touchpad')!;
    ptr(pad, 'pointerdown', 100, 100);
    ptr(pad, 'pointerup', 100, 100);
    expect(a.click).not.toHaveBeenCalled();
  });

  it('touchpad: two fingers scroll (fingers up = page down), no cursor, no click', () => {
    vi.useFakeTimers();
    mount();
    click(text('Тачпад'));
    const pad = el.querySelector('.m-touchpad')!;
    const p = (id: number, type: string, x: number, y: number) => {
      const e = new Event(type, { bubbles: true }) as any;
      e.pointerId = id;
      e.clientX = x;
      e.clientY = y;
      act(() => {
        pad.dispatchEvent(e);
      });
    };
    p(1, 'pointerdown', 100, 200);
    p(2, 'pointerdown', 160, 200);
    vi.setSystemTime(Date.now() + 40);
    p(1, 'pointermove', 100, 180);
    p(2, 'pointermove', 160, 180);
    vi.setSystemTime(Date.now() + 40);
    p(2, 'pointermove', 160, 180);
    expect(a.scroll).toHaveBeenCalled();
    const sum = a.scroll.mock.calls.reduce((n: number, c: number[]) => n + c[1], 0);
    expect(sum).toBe(20);
    expect(a.moveCursor).not.toHaveBeenCalled();
    p(1, 'pointerup', 100, 180);
    p(2, 'pointerup', 160, 180);
    expect(a.click).not.toHaveBeenCalled();
  });

  it('touchpad: «Обратная прокрутка» flips the scroll and the rest is sent on release', () => {
    vi.useFakeTimers();
    updateTouchpad({ invertScroll: true });
    mount();
    click(text('Тачпад'));
    const pad = el.querySelector('.m-touchpad')!;
    const p = (id: number, type: string, x: number, y: number) => {
      const e = new Event(type, { bubbles: true }) as any;
      e.pointerId = id;
      e.clientX = x;
      e.clientY = y;
      act(() => {
        pad.dispatchEvent(e);
      });
    };
    p(1, 'pointerdown', 100, 200);
    p(2, 'pointerdown', 160, 200);
    vi.setSystemTime(Date.now() + 40);
    p(1, 'pointermove', 100, 180);
    p(2, 'pointermove', 160, 180); // throttled: stays accumulated
    p(1, 'pointerup', 100, 180); // flushed here
    const sum = a.scroll.mock.calls.reduce((n: number, c: number[]) => n + c[1], 0);
    expect(sum).toBe(-20);
  });

  it('touchpad: no scroll strip is rendered, and an old saved scrollStrip setting loads fine', () => {
    localStorage.setItem('tsp.touchpad', JSON.stringify({ speed: 3, accel: true, tapClick: true, invertScroll: false, scrollStrip: true }));
    reloadTouchpad();
    expect(touchpad.value).toEqual({ speed: 3, accel: true, tapClick: true, invertScroll: false });
    mount();
    click(text('Тачпад'));
    expect(el.querySelector('.m-tp-strip')).toBeNull();
    expect(el.querySelector('.m-touchpad.with-strip')).toBeNull();
  });

  it('adds the mini class while the player link is live', () => {
    nowPlaying.value = { title: 'x' } as any;
    lastSeen.value = Date.now();
    mount();
    expect(el.querySelector('.m-remote')!.classList.contains('mini')).toBe(true);
    nowPlaying.value = null;
    lastSeen.value = 0;
  });

  it('fits one screen: fitted class, stage around the d-pad, mini-player modifier', () => {
    mount();
    const root = el.querySelector('.m-screen')!;
    expect(root.classList.contains('m-remote')).toBe(true);
    expect(el.querySelector('.m-stage .m-dpad-wrap')).toBeTruthy();
    click(lbl('Клавиатура'));
    expect(root.classList.contains('kbd')).toBe(true);
  });

  it('touchpad settings sheet: opens from the header, saves each change', () => {
    mount();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    click(lbl('Настройки тачпада'));
    expect(el.textContent).toContain('3 из 5');
    expect(el.textContent).toContain('Медленно');
    click(lbl('Скорость 5'));
    click(lbl('Ускорение'));
    click(lbl('Касание = щелчок'));
    expect(JSON.parse(localStorage.getItem('tsp.touchpad')!)).toEqual({ speed: 5, accel: false, tapClick: false, invertScroll: false });
    click(lbl('Обратная прокрутка'));
    expect(JSON.parse(localStorage.getItem('tsp.touchpad')!).invertScroll).toBe(true);
    expect(el.textContent).toContain('5 из 5');
    click(text('Готово'));
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    reloadTouchpad();
    expect(touchpad.value.speed).toBe(5);
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

describe('Remote for Android TV', () => {
  beforeEach(() => saveTv({ ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: '0123456789abcdef0123456789abcdef' }));
  afterEach(() => {
    tvState.value = 'idle';
  });

  it('shows the name, «Android TV · подключён» and the note; no power, touchpad, channels', () => {
    mount();
    act(() => {
      tvState.value = 'connected';
    });
    expect(el.querySelector('.m-remote-title')!.textContent).toBe('Гостиная');
    expect(el.querySelector('.m-remote-state')!.textContent).toBe('Android TV · подключён');
    expect(el.querySelector('.m-remote-note')!.textContent).toBe(
      'Пульт управляет OMP на телевизоре. Включение ТВ и другие приложения — пультом от телевизора.',
    );
    expect(el.querySelector('.m-power')).toBeNull();
    expect(el.textContent).not.toContain('Тачпад');
    expect(lbl('След. серия')).toBeNull();
    expect(lbl('Пред. серия')).toBeNull();
    expect(lbl('Домой')).toBeNull();
    expect(a.warmUp).toHaveBeenCalledTimes(1);
  });

  it('shows the connection state for Android TV', () => {
    mount();
    act(() => {
      tvState.value = 'error';
    });
    expect(el.querySelector('.m-remote-state')!.textContent).toBe('Android TV · нет связи');
  });

  it('d-pad, OK, Назад, Каталог, Сейчас играет and volume', () => {
    mount();
    click(lbl('Вверх'));
    click(lbl('Влево'));
    click(text('OK'));
    click(text('Назад'));
    expect(a.pressButton.mock.calls).toEqual([['UP'], ['LEFT'], ['ENTER'], ['BACK']]);
    click(text('Каталог'));
    click(text('Сейчас играет'));
    expect(a.pressAtvKey.mock.calls).toEqual([['CATALOG'], ['NOWPLAYING']]);
    click(lbl('Громче'));
    click(lbl('Тише'));
    expect(a.volume.mock.calls).toEqual([['up'], ['down']]);
  });

  it('keyboard types on the TV', async () => {
    mount();
    click(lbl('Клавиатура'));
    const i = el.querySelector('input[aria-label="Ввод на телевизоре"]') as HTMLInputElement;
    act(() => {
      i.value = 'Дюна';
      i.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await flush();
    expect(a.typeText).toHaveBeenCalledWith('Дюна');
  });

  it('no «Подключить заново» while the token works', () => {
    mount();
    act(() => {
      tvState.value = 'connected';
    });
    expect(el.textContent).not.toContain('Подключить заново');
  });

  it('a forgetful TV offers «Подключить заново»: the code sheet pairs again', async () => {
    mount();
    act(() => {
      tvError.value = tvForgot();
      tvState.value = 'error';
    });
    expect(el.querySelector('.m-remote-forgot')!.textContent).toContain(tvForgot());
    click(text('Подключить заново'));
    const d = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(d.textContent).toContain('Гостиная · Android TV');
    const cells = Array.from(d.querySelectorAll<HTMLInputElement>('input'));
    act(() => {
      cells[0].value = '0482';
      cells[0].dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = Array.from(d.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Подключить')!;
    await act(async () => submit.click());
    await flush();
    expect(a.pairAtv).toHaveBeenCalledWith({ ip: '192.168.1.40', port: 8095, name: 'Гостиная', version: '' }, '0482');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    tvError.value = '';
  });

  it('a saved Android TV without a token (dropped after «forgot») offers «Подключить заново»', () => {
    saveTv({ ip: '192.168.1.41', name: 'Кухня', kind: 'atv', ctlPort: 8096 });
    setActiveTv('192.168.1.41');
    mount();
    click(text('Подключить заново'));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Кухня · Android TV');
  });

  it('a failed key shows a toast', async () => {
    a.pressAtvKey.mockRejectedValue(new Error('Телевизор не отвечает'));
    mount();
    click(text('Каталог'));
    await flush();
    expect(toast.value).toBe('Телевизор не отвечает');
  });
});

describe('touchpad settings maths', () => {
  it('sanitizer: defaults and clamping', () => {
    expect(sanitizeTouchpad(null)).toEqual(TOUCHPAD_DEFAULTS);
    expect(sanitizeTouchpad({ speed: 99, accel: 'x', tapClick: false, invertScroll: 1 })).toEqual({ speed: 5, accel: true, tapClick: false, invertScroll: false });
    expect(sanitizeTouchpad({ speed: -2 }).speed).toBe(1);
    expect(sanitizeTouchpad({ speed: NaN }).speed).toBe(3);
  });
  it('gain: step multipliers, acceleration capped at 2.5', () => {
    const s = (speed: number, accel: boolean) => ({ speed, accel, tapClick: true, invertScroll: false });
    expect([1, 2, 3, 4, 5].map((n) => cursorGain(s(n, false), 5))).toEqual([0.6, 0.8, 1, 1.4, 1.9]);
    expect(cursorGain(s(3, true), 0)).toBe(1);
    expect(cursorGain(s(3, true), 1)).toBeCloseTo(1.8);
    expect(cursorGain(s(3, true), 10)).toBe(2.5);
    expect(cursorGain(s(5, true), 10)).toBeCloseTo(4.75);
  });
});

describe('Remote in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => {
    applyLanguageSetting('ru');
    tvState.value = 'idle';
  });
  const noCyrillic = () => expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  const noCyrillicLabels = () =>
    expect(Array.from(el.querySelectorAll('[aria-label],[placeholder]')).map((n) => (n.getAttribute('aria-label') || '') + (n.getAttribute('placeholder') || '')).join('|')).not.toMatch(/[А-Яа-яЁё]/);

  it('without a TV: the placeholder and its button', () => {
    mount();
    expect(el.querySelector('.m-screen-head h1')!.textContent).toBe('Remote');
    expect(el.querySelector('h2')!.textContent).toBe('Connect a TV');
    expect(el.textContent).toContain('To control the TV from the phone, connect it first.');
    click(text('Connect a TV'));
    expect(currentRoute.value).toEqual({ name: 'tv' });
    noCyrillic();
  });

  it('LG remote: state, tabs, keys and their labels', () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED', mac: 'aa:bb:cc:dd:ee:ff' });
    mount();
    expect(el.querySelector('.m-remote-state')!.textContent).toBe('Not connected');
    act(() => {
      tvState.value = 'connected';
    });
    expect(el.querySelector('.m-remote-state')!.textContent).toBe('Connected');
    expect(Array.from(el.querySelectorAll('[role=tab]')).map((b) => b.textContent)).toEqual(['Buttons', 'Touchpad']);
    for (const l of ['Touchpad settings', 'Turn off the TV', 'Up', 'Down', 'Left', 'Right', 'Back', 'Home', 'Menu', 'Back 10 s', 'Prev. episode', 'Pause', 'Next episode', 'Forward 10 s', 'Quieter', 'Keyboard', 'Louder']) {
      expect(lbl(l), l).toBeTruthy();
    }
    click(lbl('Pause'));
    return flush().then(() => {
      expect(lbl('Play')).toBeTruthy();
      noCyrillic();
      noCyrillicLabels();
    });
  });

  it('LG remote: touchpad hint, keyboard field, power question and toasts', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    mount();
    act(() => {
      tvState.value = 'connected';
    });
    click(text('Touchpad'));
    expect(el.querySelector('.m-touchpad')!.getAttribute('aria-label')).toBe('Touchpad');
    expect(el.querySelector('.m-touchpad .m-muted')!.textContent).toBe('Swipe with a finger · two fingers scroll');
    click(lbl('Keyboard'));
    expect(el.querySelector('input.m-input')!.getAttribute('aria-label')).toBe('Typing on the TV');
    expect(el.querySelector('input.m-input')!.getAttribute('placeholder')).toBe('Type — the text goes to the TV');
    click(lbl('Turn off the TV'));
    expect(a.confirm).toHaveBeenCalledWith('Turn off LG OLED?');
    await flush();
    expect(toast.value).toBe('The TV is turning off');
    act(() => {
      tvState.value = 'idle';
    });
    click(lbl('Turn on the TV'));
    await flush();
    expect(toast.value).toBe('Connect to the TV while it is on — then you can turn it on from the phone');
    noCyrillic();
    noCyrillicLabels();
  });

  it('LG remote: waking and the touchpad', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED', mac: 'aa:bb:cc:dd:ee:ff' });
    mount();
    click(lbl('Turn on the TV'));
    await flush();
    expect(toast.value).toBe('Turning on LG OLED…');
    click(text('Touchpad'));
    expect(el.querySelector('.m-tp-strip')).toBeNull();
    noCyrillicLabels();
  });

  it('Android TV: state line, note, keys and labels', () => {
    saveTv({ ip: '192.168.1.40', name: 'Living room', kind: 'atv', token: '0123456789abcdef0123456789abcdef' });
    mount();
    act(() => {
      tvState.value = 'connected';
    });
    expect(el.querySelector('.m-remote-state')!.textContent).toBe('Android TV · connected');
    expect(el.querySelector('.m-remote-note')!.textContent).toBe('The remote controls OMP on the TV. Turning the TV on and other apps — with the TV’s own remote.');
    expect(Array.from(el.querySelectorAll('.m-keyrow')[0].querySelectorAll('button')).map((b) => (b.textContent || '').trim())).toEqual(['Back', 'Catalog', 'Now playing']);
    expect(el.querySelector('.m-vol-label')!.textContent).toBe('Vol.');
    for (const l of ['Keyboard', 'Quieter', 'Louder', 'Up', 'Down', 'Left', 'Right']) expect(lbl(l), l).toBeTruthy();
    act(() => {
      tvState.value = 'error';
    });
    expect(el.querySelector('.m-remote-state')!.textContent).toBe('Android TV · no connection');
    noCyrillic();
    noCyrillicLabels();
  });

  it('Android TV: «Connect again» (including the «forgot» message)', () => {
    saveTv({ ip: '192.168.1.40', name: 'Living room', kind: 'atv' });
    mount();
    expect(byBtn('Connect again')).toBeTruthy();
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });
});

function byBtn(t: string) {
  return Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === t);
}
