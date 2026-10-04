import { describe, it, expect } from 'vitest';
import {
  buildCaption,
  buildKeyboard,
  buildFiles,
  routeFiles,
  buildLinksMessage,
  oversizeLogLine,
  escapeHtml,
  CAPTION_MAX,
  UPLOAD_MAX,
} from '../../scripts/telegram-lib.mjs';

const MB = 1024 * 1024;
const DL = 'https://github.com/spacesarmat/omp/releases/download/v0.14.1';

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

  it('lists the build files in posting order: arm64, armv7, ipk, universal', () => {
    expect(buildFiles('0.14.1')).toEqual([
      'OMP-0.14.1-arm64.apk',
      'OMP-0.14.1-armv7.apk',
      'OMP-0.14.1-webOS.ipk',
      'OMP-0.14.1.apk',
    ]);
  });

  it('routes files by the bot limit and keeps the order', () => {
    const files = [
      { name: 'a', size: 67 * MB },
      { name: 'b', size: 36 * MB },
      { name: 'c', size: UPLOAD_MAX },
      { name: 'd', size: UPLOAD_MAX + 1 },
    ];
    const r = routeFiles(files);
    expect(r.upload.map((f) => f.name)).toEqual(['b', 'c']);
    expect(r.link.map((f) => f.name)).toEqual(['a', 'd']);
  });

  it('names every oversize file with its GitHub link in the closing reply', () => {
    const m = buildLinksMessage('v0.14.1', [{ name: 'OMP-0.14.1-arm64.apk' }, { name: 'OMP-0.14.1.apk' }]);
    expect(m).toBe(
      `Файл OMP-0.14.1-arm64.apk больше 50 МБ — скачать: ${DL}/OMP-0.14.1-arm64.apk\n` +
        `Файл OMP-0.14.1.apk больше 50 МБ — скачать: ${DL}/OMP-0.14.1.apk`,
    );
  });

  it('logs the size in MB for a manual forward', () => {
    expect(oversizeLogLine({ name: 'OMP-0.14.1-arm64.apk', size: 67.2 * MB })).toBe(
      'Telegram: OMP-0.14.1-arm64.apk is 68 MB — forward it manually from GitHub',
    );
  });

  it('builds per-ABI, ipk, release and support buttons', () => {
    const k = buildKeyboard({ tag: 'v0.14.1', version: '0.14.1', donateUrl: 'https://boosty.to/x/donate' });
    expect(k.inline_keyboard.flat().map((b) => b.text)).toEqual(['arm64', 'armv7', 'Для LG (ipk)', 'Что нового', 'Поддержать']);
    expect(k.inline_keyboard.flat().map((b) => b.url)).toEqual([
      `${DL}/OMP-0.14.1-arm64.apk`,
      `${DL}/OMP-0.14.1-armv7.apk`,
      `${DL}/OMP-0.14.1-webOS.ipk`,
      'https://github.com/spacesarmat/omp/releases/tag/v0.14.1',
      'https://boosty.to/x/donate',
    ]);
    expect(buildKeyboard({ tag: 'v1', version: '1' }).inline_keyboard.flat()).toHaveLength(4);
  });
});
