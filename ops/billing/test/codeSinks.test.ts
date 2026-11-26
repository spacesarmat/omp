import { describe, expect, it } from 'vitest';
import { formatCode, safeCode, appSchemeUrl, searchPathOption } from '../src/logic.mjs';
import { goPage } from '../src/go.mjs';
import { normalizeCode, randomCode } from '../src/crypto.mjs';
import { plainText } from '../src/botCopy.mjs';

const CODE_OK = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

describe('code text never reaches a page or a link raw', () => {
  it('safeCode keeps only a real code', () => {
    expect(safeCode('ABCD2345')).toBe('ABCD-2345');
    expect(safeCode('abcd-2345')).toBe('ABCD-2345');
    expect(safeCode('')).toBe('');
    expect(safeCode('AB')).toBe('');
    expect(safeCode('</script><svg onload=alert(1)>')).toBe('');
    expect(safeCode('ABCD2345EXTRA')).toBe('');
  });

  it('formatCode still shows a stored code as it is (a message to a person is not a page)', () => {
    expect(formatCode('ABCD-EF12')).toBe('ABCD-EF12');
    expect(formatCode('ABCD2345')).toBe('ABCD-2345');
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

describe('plain text of an invoice description', () => {
  it('restores entities before the tags go away', () => {
    expect(plainText('<b>Оплата</b> 300 ₽')).toBe('Оплата 300 ₽');
    // "&lt;b&gt;" is markup only after the unescape: stripping first would let it back in
    expect(plainText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('alert(1)');
    expect(plainText('&lt;script&gt;alert(1)&lt;/script&gt;')).not.toContain('<script');
    expect(plainText('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });

  it('repeats the tag pass until nothing is left of a nested tag', () => {
    const nested = '<scr<script>ipt>alert(1)</ipt>';
    expect(plainText(nested)).not.toContain('<script');
    expect(plainText(nested)).toContain('alert(1)');
    expect(plainText('')).toBe('');
    expect(plainText(null)).toBe('');
  });
});

describe('a schema name for the server options', () => {
  it('accepts only a plain identifier', () => {
    expect(searchPathOption('http_lz1a2b_9f8e7d6c')).toBe('-c search_path="http_lz1a2b_9f8e7d6c"');
    // the value is parsed by Postgres before any SQL quoting, so a quote or a space here would be a second option
    expect(() => searchPathOption('a" -c log_min_messages=debug1')).toThrow(/plain identifier/);
    expect(() => searchPathOption('a\\b')).toThrow(/plain identifier/);
    expect(() => searchPathOption('схема')).toThrow(/plain identifier/);
    expect(() => searchPathOption('1abc')).toThrow(/plain identifier/);
  });
});
