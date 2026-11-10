import { describe, expect, it } from 'vitest';

// @ts-ignore plain module
import { BLOOM_BITS, BLOOM_CAP, asBloom, bdecode, countSetBits, decodeScrape, estimateBloom, mergeBloom } from '../dht-peers/src/bloom.mjs';

function withBits(n: number): Buffer {
  const buf = Buffer.alloc(256);
  let left = n;
  for (let i = 0; i < buf.length && left > 0; i++) {
    let byte = 0;
    for (let bit = 0; bit < 8 && left > 0; bit++) {
      byte |= 1 << bit;
      left--;
    }
    buf[i] = byte;
  }
  return buf;
}

function bencodeBytes(name: string, buf: Buffer): Buffer {
  return Buffer.concat([Buffer.from(String(name.length) + ':' + name), Buffer.from(String(buf.length) + ':'), buf]);
}

describe('BEP 33 bloom filter math', () => {
  it('uses the published formula and caps a full filter', () => {
    expect(estimateBloom(Buffer.alloc(256))).toBe(0);
    expect(countSetBits(withBits(100))).toBe(100);
    expect(estimateBloom(withBits(100))).toBe(51);
    expect(estimateBloom(withBits(2))).toBe(1);
    expect(estimateBloom(withBits(1))).toBe(1);
    expect(estimateBloom(withBits(BLOOM_BITS))).toBe(BLOOM_CAP);
    expect(estimateBloom(Buffer.alloc(255))).toBe(null);
    expect(asBloom('nope')).toBe(null);
  });

  it('ORs filters before the estimate', () => {
    const a = Buffer.alloc(256);
    const b = Buffer.alloc(256);
    a[0] = 0x01;
    b[0] = 0x02;
    const merged = mergeBloom(a, b);
    expect(merged[0]).toBe(0x03);
    expect(countSetBits(merged)).toBe(2);
    expect(estimateBloom(merged)).toBe(1);
    expect(mergeBloom(null, Buffer.alloc(10))).toBe(null);
  });

  it('parses BFsd and BFpe from a bencoded get_peers reply', () => {
    const seeds = withBits(100);
    const peers = withBits(2);
    const body = Buffer.concat([
      Buffer.from('d1:rd'),
      bencodeBytes('BFpe', peers),
      bencodeBytes('BFsd', seeds),
      Buffer.from('ee'),
    ]);
    const parsed = decodeScrape(body);
    expect(parsed.seeds.equals(seeds)).toBe(true);
    expect(parsed.peers.equals(peers)).toBe(true);
    expect(estimateBloom(parsed.seeds)).toBe(51);
    expect(estimateBloom(parsed.peers)).toBe(1);
    expect(decodeScrape(Buffer.from('d1:rd4:BFsd3:noee'))).toBe(null);
    expect(bdecode(Buffer.from('i42e'))).toBe(42);
    expect(bdecode(body.slice(0, 8))).toBe(null);
  });
});
