import { describe, it, expect } from 'vitest';
import {
  buildCaption,
  buildKeyboard,
  buildFiles,
  escapeHtml,
  CAPTION_MAX,
  CAPTION_NOTES_MAX,
  CAPTION_FALLBACK,
} from '../../scripts/telegram-lib.mjs';

const DL = 'https://github.com/spacesarmat/omp/releases/download/v0.14.1';

describe('telegram-lib', () => {
  it('escapes HTML', () => {
    expect(escapeHtml('a <b> & c')).toBe('a &lt;b&gt; &amp; c');
  });

  it('builds a caption with the version and the changelog lines', () => {
    const c = buildCaption('0.14.1', ['Поддержать OMP', 'Окна <выбора>']);
    expect(c).toBe('<b>OMP 0.14.1</b>\n\n• Поддержать OMP\n• Окна &lt;выбора&gt;');
  });

  it('keeps only the first bullets and has no text links (the buttons carry them)', () => {
    const notes = Array.from({ length: 13 }, (_, i) => `Пункт ${i}`);
    const c = buildCaption('1.0.0', notes);
    expect(CAPTION_NOTES_MAX).toBe(5);
    expect(c.match(/• /g)).toHaveLength(CAPTION_NOTES_MAX);
    expect(c).toContain('• Пункт 4');
    expect(c).not.toContain('Пункт 5');
    expect(c).not.toMatch(/<a |https?:|GitHub/);
    expect(c).not.toMatch(/README|установ/i);
  });

  it('cuts on a whole line and stays under the Telegram limit', () => {
    const notes = Array.from({ length: 30 }, (_, i) => `Пункт ${i} `.repeat(8));
    const c = buildCaption('1.0.0', notes);
    expect(c.length).toBeLessThanOrEqual(CAPTION_MAX);
    expect(c).not.toContain('<a ');
    expect(c).toContain('• Пункт 0');
  });

  it('no user bullet: «Исправления и улучшения», never a «[tech]» one', () => {
    const fallback = '<b>OMP 1.0.1</b>\n\n• Исправления и улучшения';
    expect(CAPTION_FALLBACK).toBe('Исправления и улучшения');
    expect(buildCaption('1.0.1', [])).toBe(fallback);
    expect(buildCaption('1.0.1', ['[tech] Биллинг', ' '])).toBe(fallback);
    expect(buildCaption('1.0.1', ['[tech] CI', 'Новое'])).not.toMatch(/tech|CI|Исправления/);
  });

  it('cuts a single huge line', () => {
    const c = buildCaption('1.0.0', ['слово '.repeat(400)]);
    expect(c.length).toBeLessThanOrEqual(CAPTION_MAX);
  });

  it('lists the build files: arm64, armv7, ipk, universal', () => {
    expect(buildFiles('0.14.1')).toEqual([
      'OMP-0.14.1-arm64.apk',
      'OMP-0.14.1-armv7.apk',
      'OMP-0.14.1-webOS.ipk',
      'OMP-0.14.1.apk',
    ]);
  });

  it('builds per-ABI, universal, ipk, GitHub release and support buttons: a button for every build file', () => {
    const k = buildKeyboard({ tag: 'v0.14.1', version: '0.14.1', donateUrl: 'https://boosty.to/x/donate' });
    expect(k.inline_keyboard.flat().map((b) => b.text)).toEqual(['arm64', 'armv7', 'Универсальный', 'Для LG (ipk)', 'Что нового', 'Поддержать']);
    expect(k.inline_keyboard.flat().map((b) => b.url)).toEqual([
      `${DL}/OMP-0.14.1-arm64.apk`,
      `${DL}/OMP-0.14.1-armv7.apk`,
      `${DL}/OMP-0.14.1.apk`,
      `${DL}/OMP-0.14.1-webOS.ipk`,
      'https://github.com/spacesarmat/omp/releases/tag/v0.14.1',
      'https://boosty.to/x/donate',
    ]);
    const urls = k.inline_keyboard.flat().map((b) => b.url);
    for (const f of buildFiles('0.14.1')) expect(urls).toContain(`${DL}/${f}`);
    expect(buildKeyboard({ tag: 'v1', version: '1' }).inline_keyboard.flat()).toHaveLength(5);
  });
});
