import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/sources/liveSeedsRun', () => ({
  probeSeeds: vi.fn(() => new Promise(() => undefined)),
}));

import { probeSeeds } from '../../src/sources/liveSeedsRun';
import { SeedCheck } from '../../src/ui/SeedCheck';
import type { SourceResult } from '../../src/sources/types';

const row = { Title: 'Dune', Seed: 7, Peer: 1, Magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), Hash: 'a'.repeat(40) } as SourceResult;

beforeAll(() => {
  init({ debug: false, visualDebug: false });
});

describe('TV seed check click', () => {
  it('does not run the parent row action', () => {
    const parent = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
      render(
        h('div', { onClick: parent }, h(SeedCheck, { r: row, fallback: '7 seeds', tv: true, focusKey: 'seed-dune' })),
        host,
      );
    });
    const btn = host.querySelector('.seed-check') as HTMLElement;
    act(() => { btn.click(); });
    expect(parent).not.toHaveBeenCalled();
    expect(probeSeeds).toHaveBeenCalledTimes(1);
    act(() => render(null, host));
    host.remove();
  });
});
