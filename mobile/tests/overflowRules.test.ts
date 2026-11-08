import { describe, expect, it } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';

const harness = readFileSync('mobile/dev/overflowHarness.tsx', 'utf8').replace(/\r\n/g, '\n');
const css = readFileSync('mobile/src/mobile.css', 'utf8').replace(/\r\n/g, '\n');

describe('mobile overflow regressions', () => {
  it('treats generic chip rows as reachable horizontal scrollers', () => {
    expect(harness).toMatch(/ROW_SCROLLERS = '[^']*\.m-chips/);
  });

  it('has compact news tabs and a stacked calendar filter on narrow screens', () => {
    expect(css).toMatch(/@media \(max-width: 374px\)[\s\S]*\.m-screen\[data-route='news'\] \.m-seg button \{[^}]*font-size: 12px/);
    expect(css).toMatch(/@media \(max-width: 374px\)[\s\S]*\.m-cal-tools \{ flex-direction: column;/);
  });

  it('exposes the overflow check locally and in CI', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:overflow']).toBe('node scripts/overflow-check.mjs');
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('run: npm run check:overflow');
  });
});
