import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { routeStack, navigate, goBack, resetTo, switchTab } from '../src/nav';
import { resetScrollMemory, RESTORE_WINDOW_MS } from '../src/scrollMemory';

// jsdom neither lays out nor scrolls: the page height and the scroll offset are plain numbers here
let top = 0;
let height = 3000;
const VIEW = 800;

function scrollBy(y: number): void {
  top = y;
}

function frames(ms: number): void {
  vi.advanceTimersByTime(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 16) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('innerHeight', VIEW);
  const el = document.documentElement;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, height - VIEW));
    },
  });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => height });
  top = 0;
  height = 3000;
  resetScrollMemory();
  resetTo({ name: 'settings' });
  frames(50);
});

afterEach(() => {
  resetScrollMemory();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('scroll memory', () => {
  it('a pushed screen starts at the top and «Назад» brings the scroll back', () => {
    scrollBy(1200);
    navigate({ name: 'install' });
    frames(50);
    expect(top).toBe(0);
    goBack();
    frames(50);
    expect(top).toBe(1200);
  });

  it('waits for a list that renders later', () => {
    scrollBy(1500);
    navigate({ name: 'log' });
    frames(50);
    // the previous screen comes back empty: the data arrives half a second later
    height = 900;
    goBack();
    frames(100);
    expect(top).toBe(100);
    height = 3000;
    frames(500);
    expect(top).toBe(1500);
  });

  it('gives up after the window and when the user touches the page', () => {
    scrollBy(1500);
    navigate({ name: 'log' });
    height = 900;
    goBack();
    frames(RESTORE_WINDOW_MS + 100);
    height = 3000;
    frames(200);
    expect(top).toBe(100);

    scrollBy(1500);
    navigate({ name: 'log' });
    height = 900;
    goBack();
    frames(50);
    window.dispatchEvent(new Event('touchstart'));
    height = 3000;
    frames(200);
    expect(top).toBe(100);
  });

  it('a new navigation cancels a pending restore', () => {
    scrollBy(1500);
    navigate({ name: 'log' });
    height = 900;
    goBack();
    frames(50);
    navigate({ name: 'faq' });
    height = 3000;
    frames(300);
    expect(top).toBe(0);
  });

  it('each bottom tab keeps its own scroll', () => {
    switchTab({ name: 'library' });
    frames(50);
    scrollBy(700);
    switchTab({ name: 'settings' });
    frames(50);
    expect(top).toBe(0);
    scrollBy(400);
    switchTab({ name: 'library' });
    frames(50);
    expect(top).toBe(700);
    switchTab({ name: 'settings' });
    frames(50);
    expect(top).toBe(400);
  });

  it('a tab left from a sub-screen keeps the scroll of its root', () => {
    scrollBy(900);
    navigate({ name: 'install' });
    frames(50);
    scrollBy(300);
    switchTab({ name: 'library' });
    frames(50);
    switchTab({ name: 'settings' });
    frames(50);
    expect(routeStack.value).toEqual([{ name: 'settings' }]);
    expect(top).toBe(900);
  });

  it('tapping the open tab goes to the top', () => {
    scrollBy(1200);
    switchTab({ name: 'settings' });
    frames(50);
    expect(top).toBe(0);
  });

  it('a tab switch with data and resetTo start at the top', () => {
    switchTab({ name: 'news' });
    frames(50);
    scrollBy(600);
    switchTab({ name: 'library' });
    frames(50);
    switchTab({ name: 'news', seg: 'subs', finding: 'f1' });
    frames(50);
    expect(top).toBe(0);
    scrollBy(800);
    resetTo({ name: 'library' });
    frames(50);
    expect(top).toBe(0);
  });
});
