import { describe, it, expect } from 'vitest';
import { subnetOf, candidateSubnets, discover } from '../../src/api/discovery';

describe('subnet helpers', () => {
  it('subnetOf', () => {
    expect(subnetOf('192.168.1.191')).toBe('192.168.1');
    expect(subnetOf('bad')).toBeNull();
  });
  it('candidateSubnets dedups and orders', () => {
    expect(candidateSubnets('10.0.0.7', ['http://192.168.1.191:5665', 'http://10.0.0.2:8090'])).toEqual([
      '10.0.0', '192.168.1', '192.168.0',
    ]);
    expect(candidateSubnets(null, [])).toEqual(['192.168.1', '192.168.0']);
  });
});

describe('discover', () => {
  it('scans hosts and ports with injected probe', async () => {
    const progress: number[] = [];
    const found = await discover({
      subnets: ['10.0.0'],
      probe: (url) => Promise.resolve(url === 'http://10.0.0.5:8090' ? 'MatriX.145.1' : null),
      onProgress: (done, total) => { if (done === total) progress.push(total); },
    });
    expect(found).toEqual([{ url: 'http://10.0.0.5:8090', version: 'MatriX.145.1' }]);
    expect(progress).toEqual([508]);
  });
  it('treats probe rejection as miss', async () => {
    const found = await discover({ subnets: ['10.0.1'], ports: [8090], probe: () => Promise.reject(new Error('x')) });
    expect(found).toEqual([]);
  });
});
