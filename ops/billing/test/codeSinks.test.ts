import { describe, expect, it } from 'vitest';
import { formatCode, appSchemeUrl } from '../src/logic.mjs';
import { goPage } from '../src/go.mjs';
import { normalizeCode, randomCode } from '../src/crypto.mjs';

const CODE_OK = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

describe('code text never reaches a page or a link raw', () => {
  it('formatCode keeps only a real code', () => {
    expect(formatCode('ABCD2345')).toBe('ABCD-2345');
    expect(formatCode('abcd-2345')).toBe('ABCD-2345');
    expect(formatCode('')).toBe('');
    expect(formatCode('AB')).toBe('');
    expect(formatCode('</script><svg onload=alert(1)>')).toBe('');
    expect(formatCode('ABCD2345EXTRA')).toBe('');
  });

  it('an app link with a bad code carries nothing', () => {
    expect(appSchemeUrl('ABCD2345')).toBe('omp://billing?code=ABCD-2345');
    expect(appSchemeUrl('<b>x</b>')).toBe('omp://billing?code=');
  });

  it('the /go/ page shows the error text and no part of the visitor input', () => {
    const evil = '</script><svg onload=alert(1)>';
    const html = goPage(evil);
    expect(html).toContain('Некорректный код');
    expect(html).not.toContain('svg');
    expect(html).not.toContain('onload');
    expect(html.indexOf('<script')).toBe(-1);
  });

  it('a valid code renders dashed, escaped and with a plain redirect', () => {
    const html = goPage('abcd-2345');
    expect(html).toContain('ABCD-2345');
    expect(html).toContain('omp://billing?code=ABCD-2345');
    expect(html).toContain('location.href="omp://billing?code=ABCD-2345"');
  });
});

describe('subscription codes', () => {
  it('are eight characters of the alphabet and never 0O1I', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = randomCode();
      expect(code).toMatch(CODE_OK);
      expect(normalizeCode(code)).toHaveLength(8);
      seen.add(code);
    }
    // 32^8 possibilities: 500 draws must not collapse into a few
    expect(seen.size).toBeGreaterThan(480);
  });
});
