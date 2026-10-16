import { describe, expect, it } from 'vitest';
import { parseBillingDeepLink } from '../../src/billing/deepLink';

describe('parseBillingDeepLink', () => {
  it('reads omp://billing?code=', () => {
    expect(parseBillingDeepLink('omp://billing?code=ABCD-EFGH')).toBe('ABCD-EFGH');
  });

  it('reads /go/ from an http landing page', () => {
    expect(parseBillingDeepLink('http://192.168.1.191:8787/go/ABCD-EFGH')).toBe('ABCD-EFGH');
  });

  it('rejects junk', () => {
    expect(parseBillingDeepLink('https://example.com/')).toBeNull();
    expect(parseBillingDeepLink('omp://other?code=ABCD-EFGH')).toBeNull();
  });
});
