import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hideBootScreen } from '../src/bootScreen';

const html = readFileSync('mobile/index.html', 'utf8').replace(/\r\n/g, '\n');
const main = readFileSync('mobile/src/main.tsx', 'utf8').replace(/\r\n/g, '\n');

describe('phone boot screen', () => {
  it('mobile/index.html paints the brand screen before the bundle boots', () => {
    expect(html).toContain('<style>');
    // the page background is the brand one from the first frame, never white
    expect(html).toMatch(/html \{ background: #0F1115; \}/);
    expect(html).toContain('id="omp-boot"');
    // the OMP mark: film frame, perforations, play triangle
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 100 100"/);
    expect(html).toContain('stroke="#F5B700"');
    expect(html).toContain('M44 41 L59 50 L44 59 Z');
  });

  it('loads the web fonts without blocking the first paint', () => {
    const tag = html.split('\n').find((l) => l.includes('fonts.googleapis.com/css2')) || '';
    expect(tag).toContain('media="print"');
    expect(tag).toContain('onload="this.media=\'all\'"');
  });

  it('the app hides it after the first render', () => {
    expect(main).toMatch(/render\(<App \/>, document\.getElementById\('app'\)!\);\nhideBootScreen\(\);/);
  });

  it('hideBootScreen removes the layer and is safe without it', () => {
    document.body.innerHTML = '<div id="app"></div><div id="omp-boot">logo</div>';
    hideBootScreen();
    expect(document.getElementById('omp-boot')).toBeNull();
    expect(document.getElementById('app')).not.toBeNull();
    expect(() => hideBootScreen()).not.toThrow();
  });
});
