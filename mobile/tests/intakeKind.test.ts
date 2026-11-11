import { describe, it, expect } from 'vitest';
import { intakeKind, normalizeLink } from '../src/screens/Add';

describe('search intake', () => {
  it('sees a magnet, a hash and a torrent link', () => {
    expect(intakeKind('magnet:?xt=urn:btih:abc')).toBe('magnet');
    expect(intakeKind('0123456789abcdef0123456789abcdef01234567')).toBe('magnet');
    expect(intakeKind('https://x.test/a.torrent')).toBe('torrent');
    expect(intakeKind('dark matter')).toBeNull();
  });

  it('turns a hash into a magnet and keeps a torrent url', () => {
    expect(normalizeLink('0123456789abcdef0123456789abcdef01234567')).toBe('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567');
    expect(normalizeLink('https://x.test/a.torrent?dl=1')).toBe('https://x.test/a.torrent?dl=1');
    expect(normalizeLink('https://x.test/a.torrent?file=b.torrent&token=abc')).toBe('https://x.test/a.torrent?file=b.torrent&token=abc');
    expect(normalizeLink('https://x.test/page')).toBeNull();
  });
});
