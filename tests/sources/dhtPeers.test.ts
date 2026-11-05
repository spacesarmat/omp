import { describe, expect, it } from 'vitest';
import { lang } from '../../src/i18n';
import { askDhtPeers, dhtNeedsSubscriptionHint, dhtPeerLine, parseDhtPeersBody, seedCheckLine, setDhtPeersContext, withDhtSubscriptionHint } from '../../src/sources/dhtPeers';
import type { ProbeResult } from '../../src/sources/liveSeedsRun';

const trackerOk: ProbeResult = { ok: true, seeders: 152, leechers: 3 };
const timeout: ProbeResult = { ok: false, reason: 'timeout' };
const noTrackers: ProbeResult = { ok: false, reason: 'notrackers' };
const noHash: ProbeResult = { ok: false, reason: 'nohash' };

describe('DHT peer line', () => {
  it('parses only an approximate DHT count', () => {
    expect(parseDhtPeersBody(JSON.stringify({ peers: 12, source: 'dht', approx: true }))).toEqual({ peers: 12 });
    expect(parseDhtPeersBody(JSON.stringify({ peers: 12, source: 'dht' }))).toBe(null);
    expect(parseDhtPeersBody(JSON.stringify({ peers: 12, source: 'tracker', approx: true }))).toBe(null);
    expect(parseDhtPeersBody('nope')).toBe(null);
    expect(parseDhtPeersBody(JSON.stringify({ peers: -1, source: 'dht', approx: true }))).toBe(null);
  });

  it('puts the estimate beside a tracker answer and uses it when the tracker missed', () => {
    lang.value = 'ru';
    expect(dhtPeerLine(1)).toBe('≈1 пир онлайн · по DHT');
    expect(dhtPeerLine(2)).toBe('≈2 пира онлайн · по DHT');
    expect(dhtPeerLine(5)).toBe('≈5 пиров онлайн · по DHT');
    expect(seedCheckLine(trackerOk, { ok: true, peers: 40 })).toBe('152 сида · 3 лича · сейчас · ≈40 пиров онлайн · по DHT');
    expect(seedCheckLine(trackerOk, { ok: false, reason: 'skip' })).toBe('152 сида · 3 лича · сейчас');
    expect(seedCheckLine(timeout, { ok: true, peers: 0 })).toBe('≈0 пиров онлайн · по DHT');
    expect(seedCheckLine(noTrackers, { ok: true, peers: 8 })).toBe('≈8 пиров онлайн · по DHT');
    expect(seedCheckLine(timeout, null)).toBe('Трекер не ответил');
    expect(seedCheckLine(noHash, null)).toBe('Нет адреса трекера');
  });

  it('uses the English labels', () => {
    lang.value = 'en';
    expect(dhtPeerLine(1)).toBe('≈1 peer online · via DHT');
    expect(seedCheckLine(trackerOk, { ok: true, peers: 40 })).toBe('152 seeds · 3 leechers · now · ≈40 peers online · via DHT');
    lang.value = 'ru';
  });

  it('does not call billing without a session or a hash', async () => {
    expect(await askDhtPeers('')).toEqual({ ok: false, reason: 'skip' });
    expect(await askDhtPeers('ab'.repeat(20))).toEqual({ ok: false, reason: 'skip' });
  });

  it('hints about a subscription only when the device could call DHT and is not signed in', () => {
    lang.value = 'ru';
    setDhtPeersContext(() => null);
    expect(dhtNeedsSubscriptionHint()).toBe(false);
    setDhtPeersContext(() => ({ http: { get: () => Promise.resolve({ status: 0, url: '', text: '' }), post: () => Promise.resolve({ status: 0, url: '', text: '' }), clearCookies: () => Promise.resolve() }, client: null }));
    expect(dhtNeedsSubscriptionHint()).toBe(true);
    expect(withDhtSubscriptionHint('Трекер не ответил')).toBe('Трекер не ответил. Проверка по DHT - с подпиской OMP');
    expect(withDhtSubscriptionHint(withDhtSubscriptionHint('Трекер не ответил'))).toBe('Трекер не ответил. Проверка по DHT - с подпиской OMP');
    lang.value = 'en';
    expect(withDhtSubscriptionHint('The tracker did not answer')).toBe('The tracker did not answer. DHT check needs an OMP subscription');
    lang.value = 'ru';
    setDhtPeersContext(null);
  });
});
