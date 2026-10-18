import { describe, it, expect, afterEach, vi } from 'vitest';
import { bytesFromB64, bytesToB64, handoffTorrent, linkWithTrackers, mergeMagnetTrackers, trackersFromMagnet, trackersFromTorrent, TV_TORRENT_MAX } from '../../src/lib/announce';
import { clearLog, log, logEntries } from '../../src/lib/log';

const HASH = 'ab'.repeat(20);
const PASS = 'SECRET-PASSKEY-99';
const HTTP = 'http://tracker.example/announce?passkey=' + PASS;
const UDP = 'udp://tracker.example:2710/announce';
const PUBLIC = 'udp://open.tracker.test:6969/announce';

function bstr(s: string): string {
  return s.length + ':' + s;
}

function torrentBytes(): Uint8Array {
  const text = 'd8:announce' + bstr(HTTP) + '13:announce-listll' + bstr(UDP) + 'eee';
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
  return out;
}

afterEach(() => {
  clearLog();
  vi.restoreAllMocks();
});

describe('trackers from a magnet', () => {
  it('keeps every tr= and does not drop one that is already there', () => {
    const magnet = 'magnet:?xt=urn:btih:' + HASH + '&dn=Name&tr=' + encodeURIComponent(PUBLIC) + '&tr=' + encodeURIComponent(HTTP);
    expect(trackersFromMagnet(magnet)).toEqual([PUBLIC, HTTP]);
    const merged = mergeMagnetTrackers(magnet, [PUBLIC, UDP]);
    expect(merged).toContain('tr=' + encodeURIComponent(PUBLIC));
    expect(merged).toContain('tr=' + encodeURIComponent(HTTP));
    expect(merged).toContain('tr=' + encodeURIComponent(UDP));
    expect(merged.indexOf('tr=' + encodeURIComponent(PUBLIC))).toBeLessThan(merged.indexOf('tr=' + encodeURIComponent(UDP)));
    expect(merged).not.toContain('RetrackersMode');
  });

  it('leaves an http link and a stashed file alone', () => {
    expect(linkWithTrackers('https://jackett/dl/1.torrent', [HTTP])).toBe('https://jackett/dl/1.torrent');
    expect(linkWithTrackers('omp-file:3', [HTTP])).toBe('omp-file:3');
  });
});

describe('trackers from a .torrent', () => {
  it('reads announce and announce-list and puts them on the fallback magnet', () => {
    const bytes = torrentBytes();
    expect(trackersFromTorrent(bytes)).toEqual([HTTP, UDP]);
    const hand = handoffTorrent(bytes, { Title: 'Gangsterland', Hash: HASH, Magnet: 'magnet:?xt=urn:btih:' + HASH + '&tr=' + encodeURIComponent(PUBLIC) });
    expect(hand).toBeTruthy();
    expect(hand!.link).toContain('xt=urn:btih:' + HASH);
    expect(hand!.link).toContain('tr=' + encodeURIComponent(PUBLIC));
    expect(hand!.link).toContain('tr=' + encodeURIComponent(HTTP));
    expect(hand!.link).toContain('tr=' + encodeURIComponent(UDP));
    expect(hand!.file).toBe(bytesToB64(bytes));
    expect(bytesFromB64(hand!.file!)).toEqual(bytes);
  });

  it('does not log a passkey while the announce is built', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const hand = handoffTorrent(torrentBytes(), { Hash: HASH });
    log('info', 'search', 'add ' + (hand && hand.link));
    log('warn', 'search', 'tracker passkey=' + PASS);
    const stored = logEntries().map((e) => e.x).join('\n');
    expect(stored).not.toContain(PASS);
    expect(stored).toContain('passkey=***');
    const dumped = [spy, warn, err, info].map((s) => s.mock.calls.map((c) => c.join(' ')).join('\n')).join('\n');
    expect(dumped).not.toContain(PASS);
    expect(hand!.link).toContain(PASS);
  });

  it('skips the file when it is over the TV cap but still returns the magnet', () => {
    const big = new Uint8Array(TV_TORRENT_MAX + 1);
    big[0] = 'd'.charCodeAt(0);
    const hand = handoffTorrent(big, { Hash: HASH, Magnet: 'magnet:?xt=urn:btih:' + HASH + '&tr=' + encodeURIComponent(HTTP) });
    expect(hand!.file).toBeUndefined();
    expect(hand!.link).toContain('tr=' + encodeURIComponent(HTTP));
  });
});
