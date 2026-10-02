import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { h } from 'preact';
import { Icon, KeyDot, ICON_NAMES } from '../../src/ui/icons';

describe('icons', () => {
  it('renders every icon as an svg with content', () => {
    for (const name of ICON_NAMES) {
      const host = document.createElement('div');
      render(h(Icon, { name, size: 30 }), host);
      const svg = host.querySelector('svg')!;
      expect(svg, name).not.toBeNull();
      expect(svg.getAttribute('width')).toBe('30');
      expect(svg.children.length, name).toBeGreaterThan(0);
    }
  });
  it('renders key dots in remote colors', () => {
    const host = document.createElement('div');
    render(h(KeyDot, { color: 'red' }), host);
    expect(host.querySelector('circle')!.getAttribute('fill')).toBe('#E5484D');
  });
});
