import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// webOS shows a black frame while the bundle boots; the brand screen has to be inline in the page, and the app
// has to drop it in the same task as its first render. Mirrors mobile/tests/bootScreen.test.ts for the TV.
const html = readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const main = readFileSync('src/main.tsx', 'utf8').replace(/\r\n/g, '\n');

describe('TV boot screen', () => {
  it('index.html paints the brand screen before the bundle boots', () => {
    expect(html).toContain('<style>');
    // the page background is the brand one from the first frame, never white
    expect(html).toMatch(/html \{ background: #0F1115; \}/);
    expect(html).toContain('id="omp-boot"');
    // the OMP mark: film frame, perforations, play triangle
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 100 100"/);
    expect(html).toContain('stroke="#F5B700"');
    expect(html).toContain('M44 41 L59 50 L44 59 Z');
  });

  it('the layer is sized for 1920x1080 and uses the TV font stack', () => {
    // the logo is 200 wide, and the wordmark is well above the 24px floor of the TV interface
    expect(html).toMatch(/<svg width="200" height="200"/);
    expect(html).toMatch(/#omp-boot b \{[^}]*font: 700 44px/);
    expect(html).toMatch(/'LG Smart UI', 'Museo Sans', Roboto, Arial, sans-serif/);
    // no web font is fetched for the launch screen: an unreachable host must not hold the first frame
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('the app removes the layer right after the first render, which waits for the language pack', () => {
    expect(main).toMatch(/render\(<App \/>, document\.getElementById\('app'\)!\);\n {2}\/\/ the brand screen[\s\S]{0,120}\n {2}hideBootScreen\(\);/);
    expect(main).toMatch(/import \{ hideBootScreen \} from '\.\.\/mobile\/src\/bootScreen';/);
    expect(main).toMatch(/loadDict\(lang\.peek\(\)\)\.then\(start, start\)/);
  });

  it('nothing is left of the layer once the app booted', async () => {
    const { hideBootScreen } = await import('../../mobile/src/bootScreen');
    document.body.innerHTML = '<div id="app"></div><div id="omp-boot"><svg></svg><b>OMP</b></div>';
    hideBootScreen();
    expect(document.getElementById('omp-boot')).toBeNull();
    expect(document.getElementById('app')).not.toBeNull();
    expect(() => hideBootScreen()).not.toThrow();
  });
});
