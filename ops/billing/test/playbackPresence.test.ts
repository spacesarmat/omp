import { describe, expect, it } from 'vitest';
import { createPresenceStore, parsePresenceInput } from '../src/playbackPresence.mjs';

const input = {
  state: 'playing',
  sessionId: 'session-1',
  sessionSeq: 1,
  hash: 'a'.repeat(40),
  fileId: 1,
  title: 'Show',
  episode: 'S01E01',
  positionSec: 10,
  durationSec: 100,
  deviceName: 'LG',
  platform: 'lg',
};

describe('playback presence parser', () => {
  it('cleans bounded fields and ignores a spoofed device id', () => {
    expect(parsePresenceInput({
      ...input,
      title: '  Show  ',
      episode: '  Episode  ',
      deviceName: '  Living room  ',
      deviceId: 'another-device',
      streamUrl: 'https://example.invalid/stream',
    })).toEqual({ ...input, title: 'Show', episode: 'Episode', deviceName: 'Living room' });
    expect(parsePresenceInput({ ...input, title: 'x'.repeat(200) }).title).toHaveLength(180);
  });

  it.each([
    ['state', 'closed'],
    ['sessionId', ''],
    ['sessionSeq', 0],
    ['sessionSeq', 1.5],
    ['hash', 'not-a-hash'],
    ['fileId', -1],
    ['fileId', 1.5],
    ['positionSec', -1],
    ['positionSec', Infinity],
    ['durationSec', NaN],
    ['platform', 'unknown'],
  ])('rejects invalid %s', (field, value) => {
    expect(parsePresenceInput({ ...input, [field]: value })).toEqual({ error: 'bad_presence' });
  });
});

describe('playback presence store', () => {
  it('stamps the authorized device, isolates accounts and expires rows', () => {
    let now = 1000;
    const store = createPresenceStore(() => now);
    const events: unknown[] = [];
    store.subscribe((accountId: string, rows: unknown) => events.push([accountId, rows]));
    store.put('account-a', 'device-a', { ...input, deviceId: 'spoofed' });
    expect(store.list('account-a')).toEqual([{ ...input, deviceId: 'device-a', updatedAt: 1000 }]);
    expect(store.list('account-b')).toEqual([]);
    expect(events).toHaveLength(1);
    now += 90001;
    expect(store.list('account-a')).toEqual([]);
    expect(events).toHaveLength(1);
  });

  it('rejects a delayed old session without emitting a change', () => {
    let now = 1000;
    const store = createPresenceStore(() => now);
    const events: unknown[] = [];
    store.subscribe((...args: unknown[]) => events.push(args));
    store.put('account-a', 'device-a', { ...input, sessionSeq: 10, title: 'New session' });
    now = 2000;
    store.put('account-a', 'device-a', { ...input, sessionId: 'session-0', sessionSeq: 9, title: 'Old session' });
    expect(store.list('account-a')[0]).toMatchObject({ sessionSeq: 10, title: 'New session', updatedAt: 1000 });
    expect(events).toHaveLength(1);
    store.put('account-a', 'device-a', { ...input, sessionId: 'session-0', sessionSeq: 10, title: 'Wrong id' });
    expect(store.list('account-a')[0].title).toBe('New session');
    expect(events).toHaveLength(1);
    store.put('account-a', 'device-a', { ...input, sessionSeq: 10, positionSec: 20 });
    expect(store.list('account-a')[0]).toMatchObject({ positionSec: 20, updatedAt: 2000 });
    expect(events).toHaveLength(2);
  });

  it('keeps a clear tombstone against delayed heartbeats and allows a newer session', () => {
    const store = createPresenceStore(() => 1000);
    const events: unknown[] = [];
    store.subscribe((...args: unknown[]) => events.push(args));
    store.put('account-a', 'device-a', { ...input, sessionSeq: 10 });
    store.clear('account-a', 'device-a');
    expect(store.put('account-a', 'device-a', { ...input, sessionSeq: 10 })).toBe(false);
    expect(store.put('account-a', 'device-a', { ...input, sessionSeq: 9 })).toBe(false);
    expect(store.list('account-a')).toEqual([]);
    expect(events).toHaveLength(2);
    expect(store.put('account-a', 'device-a', { ...input, sessionId: 'new', sessionSeq: 11 })).toBe(true);
    expect(store.list('account-a')[0]).toMatchObject({ sessionId: 'new', sessionSeq: 11 });
  });

  it('sorts playing first, clears a device and isolates listener errors', () => {
    let now = 1000;
    const store = createPresenceStore(() => now);
    const events: unknown[] = [];
    store.subscribe(() => { throw new Error('listener'); });
    store.subscribe((...args: unknown[]) => events.push(args));
    store.put('account-a', 'device-paused', { ...input, state: 'paused', sessionSeq: 2 });
    now = 2000;
    store.put('account-a', 'device-playing', { ...input, deviceName: 'TV', sessionSeq: 2 });
    expect(store.list('account-a').map((row) => row.deviceId)).toEqual(['device-playing', 'device-paused']);
    store.clear('account-a', 'device-playing');
    expect(store.list('account-a').map((row) => row.deviceId)).toEqual(['device-paused']);
    expect(events).toHaveLength(3);
  });
});
