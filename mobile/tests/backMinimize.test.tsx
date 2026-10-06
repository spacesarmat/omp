import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ minimize: vi.fn(async () => {}), exit: vi.fn(async () => {}) }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async () => ({ remove: async () => {} }),
    minimizeApp: hoisted.minimize,
    exitApp: hoisted.exit,
  },
}));

import { handleBack, resetBackPress } from '../src/app';
import { currentRoute, resetTo, navigate } from '../src/nav';
import { catalogMode, setCatalogMode } from '../src/catalog/phoneCatalog';
import { toast } from '../src/ui/toast';

beforeEach(() => {
  vi.useFakeTimers();
  hoisted.minimize.mockClear();
  hoisted.exit.mockClear();
  resetBackPress();
  setCatalogMode('mine');
  toast.value = '';
});

afterEach(() => {
  vi.useRealTimers();
});

/** «Каталог» root: two presses within 2 s. */
function backTwice() {
  handleBack();
  vi.advanceTimersByTime(500);
  handleBack();
}

describe('Back on tab roots', () => {
  it('the root of another tab switches to «Каталог», like its tab', () => {
    for (const name of ['news', 'add', 'remote', 'settings'] as const) {
      resetTo({ name });
      handleBack();
      expect(currentRoute.value).toEqual({ name: 'library' });
    }
    expect(hoisted.minimize).not.toHaveBeenCalled();
    expect(toast.value).toBe('');
  });

  it('«Обзор» switches to «Мои» first', () => {
    resetTo({ name: 'library' });
    setCatalogMode('discover');
    handleBack();
    expect(catalogMode.value).toBe('mine');
    expect(currentRoute.value.name).toBe('library');
    expect(hoisted.minimize).not.toHaveBeenCalled();
    expect(toast.value).toBe('');
  });

  it('one press on «Каталог»: only the toast', () => {
    resetTo({ name: 'library' });
    handleBack();
    expect(toast.value).toBe('Нажмите «Назад» ещё раз, чтобы свернуть');
    expect(hoisted.minimize).not.toHaveBeenCalled();
  });

  it('a second press within 2 s minimizes the app instead of exiting', () => {
    resetTo({ name: 'library' });
    handleBack();
    vi.advanceTimersByTime(1900);
    handleBack();
    expect(hoisted.minimize).toHaveBeenCalledTimes(1);
    expect(hoisted.exit).not.toHaveBeenCalled();
  });

  it('a press after 2 s shows the toast again', () => {
    resetTo({ name: 'library' });
    handleBack();
    vi.advanceTimersByTime(2500);
    expect(toast.value).toBe('');
    handleBack();
    expect(toast.value).toBe('Нажмите «Назад» ещё раз, чтобы свернуть');
    expect(hoisted.minimize).not.toHaveBeenCalled();
  });

  it('pops a nested screen first and does not minimize', () => {
    resetTo({ name: 'library' });
    navigate({ name: 'torrent', hash: 'x' });
    handleBack();
    expect(currentRoute.value.name).toBe('library');
    expect(hoisted.minimize).not.toHaveBeenCalled();
  });

  it('«Новое» is a tab root; its nested screens go back to it', () => {
    resetTo({ name: 'news' });
    navigate({ name: 'subFindings', id: 's1' });
    handleBack();
    expect(currentRoute.value.name).toBe('news');
    expect(hoisted.minimize).not.toHaveBeenCalled();
    handleBack();
    expect(currentRoute.value.name).toBe('library');
    backTwice();
    expect(hoisted.minimize).toHaveBeenCalledTimes(1);
  });

  it('survives minimizeApp rejecting', async () => {
    hoisted.minimize.mockRejectedValueOnce(new Error('no'));
    resetTo({ name: 'library' });
    expect(() => backTwice()).not.toThrow();
    await Promise.resolve();
  });
});

describe('Back with something open on top', () => {
  it('closes the open sheet instead of minimizing, then goes on as usual', async () => {
    const { render } = await import('preact');
    const { act } = await import('preact/test-utils');
    const { Sheet } = await import('../src/ui/Sheet');
    const el = document.createElement('div');
    let open = true;
    const closed = vi.fn(() => {
      open = false;
      draw();
    });
    const draw = () => act(() => render(open ? <Sheet label="Источники для поиска" onClose={closed}><div /></Sheet> : null, el));
    resetTo({ name: 'add' });
    draw();
    handleBack();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(hoisted.minimize).not.toHaveBeenCalled();
    handleBack();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(currentRoute.value.name).toBe('library');
    backTwice();
    expect(hoisted.minimize).toHaveBeenCalledTimes(1);
  });

  it('closes the sheet opened last first (a sheet over a sheet)', async () => {
    const { render } = await import('preact');
    const { act } = await import('preact/test-utils');
    const { Sheet } = await import('../src/ui/Sheet');
    const el = document.createElement('div');
    const state = { outer: true, inner: true };
    const draw = () =>
      act(() =>
        render(
          <div>
            {state.outer && <Sheet label="Вход" onClose={() => { state.outer = false; draw(); }}><div /></Sheet>}
            {state.inner && <Sheet label="Зеркало" onClose={() => { state.inner = false; draw(); }}><div /></Sheet>}
          </div>,
          el,
        ),
      );
    resetTo({ name: 'sources' } as any);
    draw();
    handleBack();
    expect(state).toEqual({ outer: true, inner: false });
    handleBack();
    expect(state).toEqual({ outer: false, inner: false });
    expect(hoisted.minimize).not.toHaveBeenCalled();
    render(null, el);
  });

  it('onBack overrides onClose for the system Back', async () => {
    const { render } = await import('preact');
    const { act } = await import('preact/test-utils');
    const { Sheet } = await import('../src/ui/Sheet');
    const el = document.createElement('div');
    const onClose = vi.fn();
    const onBack = vi.fn();
    act(() => render(<Sheet label="Обновление" onClose={onClose} onBack={onBack}><div /></Sheet>, el));
    handleBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    act(() => render(null, el));
    resetTo({ name: 'library' });
    backTwice();
    expect(hoisted.minimize).toHaveBeenCalledTimes(1);
  });
});
