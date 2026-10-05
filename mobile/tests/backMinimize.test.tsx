import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ minimize: vi.fn(async () => {}), exit: vi.fn(async () => {}) }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async () => ({ remove: async () => {} }),
    minimizeApp: hoisted.minimize,
    exitApp: hoisted.exit,
  },
}));

import { handleBack } from '../src/app';
import { currentRoute, resetTo, navigate } from '../src/nav';

beforeEach(() => {
  hoisted.minimize.mockClear();
  hoisted.exit.mockClear();
});

describe('Back on tab roots', () => {
  it('minimizes the app instead of exiting', () => {
    resetTo({ name: 'library' });
    handleBack();
    expect(hoisted.minimize).toHaveBeenCalledTimes(1);
    expect(hoisted.exit).not.toHaveBeenCalled();
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
    expect(hoisted.minimize).toHaveBeenCalledTimes(1);
  });

  it('survives minimizeApp rejecting', async () => {
    hoisted.minimize.mockRejectedValueOnce(new Error('no'));
    resetTo({ name: 'settings' });
    expect(() => handleBack()).not.toThrow();
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
    handleBack();
    expect(hoisted.minimize).toHaveBeenCalledTimes(1);
  });
});
