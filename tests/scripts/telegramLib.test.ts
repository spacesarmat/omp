import { describe, it, expect } from 'vitest';
import { buildCaption, buildKeyboard, escapeHtml, CAPTION_MAX } from '../../scripts/telegram-lib.mjs';

describe('telegram-lib', () => {
  it('escapes HTML', () => {
    expect(escapeHtml('a <b> & c')).toBe('a &lt;b&gt; &amp; c');
  });

  it('builds a caption with the version and the changelog lines', () => {
    const c = buildCaption('0.14.1', ['Поддержать OMP', 'Окна <выбора>']);
    expect(c).toBe('<b>OMP 0.14.1</b>\n\n• Поддержать OMP\n• Окна &lt;выбора&gt;');
  });

  it('cuts on a whole line and stays under the Telegram limit', () => {
    const notes = Array.from({ length: 30 }, (_, i) => `Пункт ${i} `.repeat(8));
    const c = buildCaption('1.0.0', notes);
    expect(c.length).toBeLessThanOrEqual(CAPTION_MAX);
    expect(c).toContain('…и другое');
    expect(c).toContain('• Пункт 0');
  });

  it('cuts a single huge line', () => {
    const c = buildCaption('1.0.0', ['слово '.repeat(400)]);
    expect(c.length).toBeLessThanOrEqual(CAPTION_MAX);
  });

  it('builds download, release and support buttons', () => {
    const k = buildKeyboard({ tag: 'v0.14.1', version: '0.14.1', donateUrl: 'https://boosty.to/x/donate' });
    const urls = k.inline_keyboard.flat().map((b) => b.url);
    expect(urls).toEqual([
      'https://github.com/spacesarmat/omp/releases/download/v0.14.1/OMP-0.14.1.apk',
      'https://github.com/spacesarmat/omp/releases/download/v0.14.1/OMP-0.14.1-webOS.ipk',
      'https://github.com/spacesarmat/omp/releases/tag/v0.14.1',
      'https://boosty.to/x/donate',
    ]);
    expect(buildKeyboard({ tag: 'v1', version: '1' }).inline_keyboard.flat()).toHaveLength(3);
  });
});
