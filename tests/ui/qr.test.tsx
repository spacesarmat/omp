import { describe, it, expect } from 'vitest';
import { render, h } from 'preact';
import { Qr } from '../../src/ui/Qr';

function mount(text: string, size?: number) {
  const host = document.createElement('div');
  render(h(Qr, { text, size }), host);
  return host.querySelector('svg.qr')!;
}

describe('Qr', () => {
  it('renders a square svg with dark modules', () => {
    const svg = mount('https://github.com/spacesarmat/omp/releases/latest', 220);
    expect(svg.getAttribute('width')).toBe('220');
    const vb = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(vb[0]).toBe(0);
    expect(vb[2]).toBe(vb[3]);
    expect(vb[2]).toBeGreaterThanOrEqual(21 + 4);
    const d = svg.querySelector('path')!.getAttribute('d')!;
    expect(d.length).toBeGreaterThan(100);
    expect(svg.querySelector('rect')!.getAttribute('fill')).toBe('#fff');
  });
  it('encodes different text differently', () => {
    const a = mount('https://a.example/').querySelector('path')!.getAttribute('d');
    const b = mount('https://b.example/').querySelector('path')!.getAttribute('d');
    expect(a).not.toBe(b);
  });
});
