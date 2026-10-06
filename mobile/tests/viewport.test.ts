import { describe, it, expect } from 'vitest';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
// @ts-ignore
import { join } from 'node:path';

// @ts-ignore node global
const root: string = process.cwd();
const html = readFileSync(join(root, 'mobile', 'index.html'), 'utf8') as string;
const capConfig = readFileSync(join(root, 'capacitor.config.ts'), 'utf8') as string;

function viewport(): { [k: string]: string } {
  const m = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html);
  if (!m) throw new Error('no viewport meta');
  const out: { [k: string]: string } = {};
  m[1].split(',').forEach((part) => {
    const [k, v] = part.split('=').map((s) => s.trim());
    out[k] = v;
  });
  return out;
}

describe('phone page zoom', () => {
  it('the viewport is the screen width and the page cannot be pinch- or double-tap-zoomed', () => {
    const v = viewport();
    expect(v.width).toBe('device-width');
    expect(v['initial-scale']).toBe('1');
    expect(v['maximum-scale']).toBe('1');
    expect(v['user-scalable']).toBe('no');
    // edge to edge: the safe-area insets reach the CSS (env(safe-area-inset-*))
    expect(v['viewport-fit']).toBe('cover');
  });

  it('the Capacitor WebView keeps its built-in zoom off', () => {
    expect(capConfig).toMatch(/zoomEnabled:\s*false/);
  });
});
