import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ focusKey: null as string | null }));
vi.mock('@noriginmedia/norigin-spatial-navigation', () => ({ getCurrentFocusKey: () => state.focusKey }));

import { routeStack, currentRoute, navigate, goBack, replaceRoute, resetTo, takeSavedFocus } from '../../src/ui/nav';

beforeEach(() => {
  resetTo({ name: 'library' });
  state.focusKey = null;
});

describe('nav', () => {
  it('pushes and pops', () => {
    navigate({ name: 'torrent', hash: 'x' });
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'x' });
    expect(goBack()).toBe(true);
    expect(currentRoute.value.name).toBe('library');
    expect(goBack()).toBe(false);
  });
  it('remembers focus of the screen we left', () => {
    state.focusKey = 'torrent-abc';
    navigate({ name: 'torrent', hash: 'abc' });
    expect(takeSavedFocus()).toBeUndefined();
    goBack();
    expect(takeSavedFocus()).toBe('torrent-abc');
    expect(takeSavedFocus()).toBeUndefined();
  });
  it('replace and reset', () => {
    navigate({ name: 'add' });
    replaceRoute({ name: 'torrent', hash: 'h' });
    expect(routeStack.value.map((r) => r.name)).toEqual(['library', 'torrent']);
    resetTo({ name: 'connect' });
    expect(routeStack.value).toEqual([{ name: 'connect' }]);
  });
});
