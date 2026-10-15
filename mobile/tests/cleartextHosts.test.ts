import { describe, expect, it, vi } from 'vitest';
import { cleartextHosts, guardFetch, hostOf, isLanOrLocal, needsAllowlist } from '../src/cleartextHosts';
import { answerCertChange, certChangedFingerprint, confirmCertChange } from '../src/tv/certPin';

describe('cleartext hosts', () => {
  it('reads a host and treats LAN the way the native policy does', () => {
    expect(hostOf('http://Example.COM:9117/x')).toBe('example.com');
    expect(hostOf('192.168.1.5')).toBe('192.168.1.5');
    expect(isLanOrLocal('192.168.0.2')).toBe(true);
    expect(isLanOrLocal('10.0.0.1')).toBe(true);
    expect(isLanOrLocal('127.0.0.1')).toBe(true);
    expect(isLanOrLocal('tv.local')).toBe(true);
    expect(isLanOrLocal('100.64.0.1')).toBe(false);
    expect(isLanOrLocal('example.com')).toBe(false);
    expect(needsAllowlist('http://example.com/a')).toBe(true);
    expect(needsAllowlist('http://192.168.1.2:8090/stream')).toBe(false);
    expect(needsAllowlist('https://example.com/a')).toBe(false);
  });

  it('keeps unique hosts', () => {
    expect(cleartextHosts(['http://a.test/x', 'http://A.test/y', 'http://192.168.0.1/'])).toEqual([
      'a.test',
      '192.168.0.1',
    ]);
  });

  it('waits for the allow-list only for public http', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    let waited = 0;
    const guarded = guardFetch(fetchImpl as unknown as typeof fetch, async () => {
      waited += 1;
    });
    await guarded('http://192.168.1.2/stream');
    expect(waited).toBe(0);
    await guarded('https://image.tmdb.org/x');
    expect(waited).toBe(0);
    await guarded('http://tracker.example/announce');
    expect(waited).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('certificate change prompt', () => {
  it('reads the fingerprint and resolves the sheet', async () => {
    const fp = 'ab'.repeat(32);
    expect(certChangedFingerprint({ code: 'cert-changed', message: fp })).toBe(fp);
    expect(certChangedFingerprint({ code: 'box-cert-changed', message: fp })).toBe(fp);
    expect(certChangedFingerprint({ code: 'box-failed', message: 'box-failed' })).toBeNull();
    const pending = confirmCertChange();
    answerCertChange(true);
    await expect(pending).resolves.toBe(true);
    const declined = confirmCertChange();
    answerCertChange(false);
    await expect(declined).resolves.toBe(false);
  });
});
