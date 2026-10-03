import { describe, it, expect, vi, afterEach } from 'vitest';
import { installTabSwipe, swipeTarget, swipeSwitches } from '../src/ui/tabSwipe';
import { TAB_IDS } from '../src/ui/NavBar';

const TABS = ['library', 'add', 'remote', 'settings'];

describe('swipeTarget / swipeSwitches', () => {
  it('five bottom tabs: «Новое» sits between «Каталог» and «Добавить»', () => {
    expect(TAB_IDS).toEqual(['library', 'news', 'add', 'remote', 'settings']);
    expect(swipeTarget(TAB_IDS, 'library', -100)).toBe('news');
    expect(swipeTarget(TAB_IDS, 'news', -100)).toBe('add');
    expect(swipeTarget(TAB_IDS, 'news', 100)).toBe('library');
    expect(swipeTarget(TAB_IDS, 'add', 100)).toBe('news');
    expect(swipeTarget(TAB_IDS, 'settings', -100)).toBeNull();
    expect(swipeTarget(TAB_IDS, 'subFindings', -100)).toBeNull();
  });
  it('left goes to the next tab, right to the previous; none past the ends', () => {
    expect(swipeTarget(TABS, 'library', -100)).toBe('add');
    expect(swipeTarget(TABS, 'add', 100)).toBe('library');
    expect(swipeTarget(TABS, 'library', 100)).toBeNull();
    expect(swipeTarget(TABS, 'settings', -100)).toBeNull();
    expect(swipeTarget(TABS, 'torrent', -100)).toBeNull();
  });
  it('switches past a quarter of the width or on a quick flick', () => {
    expect(swipeSwitches(-100, 1000, 400)).toBe(true);
    expect(swipeSwitches(-60, 1000, 400)).toBe(false);
    expect(swipeSwitches(-60, 80, 400)).toBe(true);
    expect(swipeSwitches(-30, 10, 400)).toBe(false);
    expect(swipeSwitches(-60, 0, 400)).toBe(true);
  });
});

describe('installTabSwipe', () => {
  let remove: (() => void) | null = null;
  afterEach(() => {
    if (remove) remove();
    remove = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function setup(current = 'library', extra = '') {
    document.body.innerHTML = '<div class="m-screen"><p id="text">x</p><div class="m-touchpad" id="pad"></div>' + extra + '</div>';
    // a phone-sized screen
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(400);
    const go = vi.fn();
    remove = installTabSwipe({ tabs: TABS, current: () => current, screen: () => document.querySelector('.m-screen'), go });
    return go;
  }
  const touch = (type: string, x: number, y: number, target: Element) => {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
    const t = { clientX: x, clientY: y };
    ev.touches = type === 'touchend' ? [] : [t];
    ev.changedTouches = [t];
    target.dispatchEvent(ev);
    return ev as Event;
  };
  const swipe = (target: Element, from: [number, number], to: [number, number]) => {
    touch('touchstart', from[0], from[1], target);
    touch('touchmove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, target);
    const mv = touch('touchmove', to[0], to[1], target);
    touch('touchend', to[0], to[1], target);
    return mv;
  };
  const text = () => document.getElementById('text')!;

  it('a long swipe left opens the next tab, right the previous one', () => {
    const go = setup('add');
    swipe(text(), [300, 300], [100, 310]);
    expect(go).toHaveBeenCalledWith('remote');
    swipe(text(), [100, 300], [320, 300]);
    expect(go).toHaveBeenLastCalledWith('library');
  });

  it('the screen follows the finger and comes back after a short swipe', () => {
    const go = setup('add');
    const scr = document.querySelector('.m-screen') as HTMLElement;
    // a slow drag: half a second from touch to release
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    touch('touchstart', 300, 300, text());
    now = 1500;
    const mv = touch('touchmove', 260, 302, text());
    expect(scr.style.transform).toBe('translateX(-40px)');
    expect(mv.defaultPrevented).toBe(true);
    touch('touchend', 260, 302, text());
    expect(go).not.toHaveBeenCalled();
    expect(scr.style.transform).toBe('');
  });

  it('ignores vertical drags, the screen edges, the touchpad and open sheets', () => {
    const go = setup('add');
    swipe(text(), [200, 100], [180, 400]);
    swipe(text(), [10, 300], [300, 300]);
    swipe(document.getElementById('pad')!, [300, 300], [50, 300]);
    const sheet = document.createElement('div');
    sheet.className = 'm-sheet-host';
    document.body.appendChild(sheet);
    swipe(text(), [300, 300], [50, 300]);
    expect(go).not.toHaveBeenCalled();
  });

  it('no tab past the last one', () => {
    const go = setup('settings');
    swipe(text(), [350, 300], [50, 300]);
    expect(go).not.toHaveBeenCalled();
  });
});
