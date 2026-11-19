import { describe, it, expect, beforeEach } from 'vitest';
import { rememberRawTitle, resetKeptQuality, torrentQuality } from '../../src/lib/keptQuality';

const H = 'a'.repeat(40);

beforeEach(() => resetKeptQuality());

describe('torrentQuality', () => {
  it('keeps the first release title and ignores a later clean name', () => {
    rememberRawTitle(H, 'Loki S02 1080p WEB-DL');
    rememberRawTitle(H, 'Loki');
    expect(torrentQuality({ hash: H, title: 'Loki' })).toBe('1080p');
  });
  it('uses the current title while it still names a resolution', () => {
    expect(torrentQuality({ hash: H, title: 'Loki 2160p' })).toBe('4K');
  });
  it('is empty when nothing names a resolution', () => {
    expect(torrentQuality({ hash: H, title: 'Loki' })).toBe('');
  });
});
