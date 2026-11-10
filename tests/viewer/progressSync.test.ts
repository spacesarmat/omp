import { describe, expect, it } from 'vitest';
import { parseProgressBody, pickContinue, type RemoteProgress } from '../../src/viewer/progressSync';

function remote(positionSec: number, other = true): RemoteProgress {
  return { positionSec: positionSec, durationSec: 3600, updatedAt: 10, otherDevice: other, label: 'S01E02', episodeKey: 's01e02' };
}

describe('continue position', () => {
  it('offers a later position from another device', () => {
    expect(pickContinue(30, remote(120))).toBe(120);
    expect(pickContinue(0, remote(90))).toBe(90);
  });

  it('keeps the local position when this device is ahead or the remote is the same device', () => {
    expect(pickContinue(500, remote(120))).toBe(500);
    expect(pickContinue(40, remote(50))).toBe(40);
    expect(pickContinue(10, remote(400, false))).toBe(10);
    expect(pickContinue(0, null)).toBe(0);
  });

  it('reads a progress body and ignores an error', () => {
    expect(parseProgressBody('{"positionSec":95,"durationSec":1000,"updatedAt":5,"otherDevice":true,"label":"S01E02"}')).toMatchObject({
      positionSec: 95,
      otherDevice: true,
    });
    expect(parseProgressBody('{"error":"none"}')).toBeNull();
    expect(parseProgressBody('')).toBeNull();
  });
});
