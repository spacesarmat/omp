import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
// @ts-ignore node builtin
import { join } from 'node:path';
// @ts-ignore node builtin
import { tmpdir } from 'node:os';
// @ts-ignore plain .mjs
import {
  assertChangelogText,
  decodeUtf8Strict,
  latestSectionBody,
  prependChangelogSection,
  readChangelogUtf8,
  writeUtf8Lf,
} from '../../scripts/changelog-encoding.mjs';

describe('changelog encoding', () => {
  it('real CHANGELOG.md is strict UTF-8 with Cyrillic in the latest section', () => {
    const md = readChangelogUtf8('CHANGELOG.md', { russian: true });
    expect(md.startsWith('# Изменения\n')).toBe(true);
    expect(latestSectionBody(md)).toMatch(/[А-Яа-яЁё]/);
    expect(md).not.toContain('\uFFFD');
  });

  it('real CHANGELOG.en.md is strict UTF-8 without Cyrillic bullets', () => {
    const md = readChangelogUtf8('CHANGELOG.en.md');
    expect(md.startsWith('# Changes\n')).toBe(true);
    expect(latestSectionBody(md)).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('rejects cp1251 bytes that broke beta.8', () => {
    // "то" in Windows-1251 is f2 ee — invalid as UTF-8
    const cp1251 = Buffer.from([0x23, 0x20, 0xf2, 0xee, 0x0a]);
    expect(() => decodeUtf8Strict(cp1251, 'cp1251')).toThrow(/not valid UTF-8/);
  });

  it('rejects a UTF-8 BOM and U+FFFD', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x6f, 0x6b]);
    expect(() => decodeUtf8Strict(bom, 'bom')).toThrow(/BOM/);
    expect(() => assertChangelogText('bad\uFFFD', 'x')).toThrow(/U\+FFFD/);
  });

  it('prependChangelogSection inserts above the first ## and keeps LF', () => {
    const md = '# Изменения\n\n## 0.1.0\n\n- старое\n';
    const out = prependChangelogSection(md, '0.2.0', ['новое', '- ещё']);
    expect(out).toBe('# Изменения\n\n## 0.2.0\n\n- новое\n- ещё\n\n## 0.1.0\n\n- старое\n');
    expect(() => prependChangelogSection(out, '0.2.0', ['x'])).toThrow(/already present/);
  });

  it('writeUtf8Lf round-trips without BOM or CRLF', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-cl-'));
    const path = join(dir, 't.md');
    try {
      writeUtf8Lf(path, '# Изменения\r\n\r\n## 1.0.0\r\n\r\n- пункт\r\n');
      const buf = readFileSync(path);
      expect(buf[0]).not.toBe(0xef);
      expect(buf.includes(0x0d)).toBe(false);
      expect(decodeUtf8Strict(buf, path)).toContain('пункт');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects classic Ð/Ñ mojibake', () => {
    expect(() => assertChangelogText('Ð¿Ñ€Ð¸Ð²ÐµÑ‚', 'moj')).toThrow(/mojibake/);
  });
});
