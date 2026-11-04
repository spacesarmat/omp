import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sanitizePhoneLink, savePhoneLink, setPhoneSubscribed, expirePhoneSub, forgetPhoneLink, phoneLink, phoneLinkSubscribed, PHONE_KEY, PHONE_SUB_TTL_MS } from '../../src/phone/phoneStore';

const PH = { url: 'http://192.168.1.20:8097', token: 'a'.repeat(32), name: 'Samsung SM-G998B' };

beforeEach(() => {
  forgetPhoneLink();
  localStorage.clear();
});

describe('phoneStore', () => {
  it('sanitizes and survives reload', async () => {
    expect(sanitizePhoneLink({ url: 'http://10.0.0.3:8097', token: 'b'.repeat(32), name: 'A\u0001B', at: 5 })).toEqual({
      url: 'http://10.0.0.3:8097',
      token: 'b'.repeat(32),
      name: 'A B',
      at: 5,
    });
    expect(sanitizePhoneLink({ url: 'ftp://x', token: 'b'.repeat(32), name: '' })).toBeNull();
    expect(sanitizePhoneLink('garbage')).toBeNull();

    expect(sanitizePhoneLink({ ...PH, sub: true }, 3)).toMatchObject({ sub: true, at: 3 });
    expect(sanitizePhoneLink({ ...PH, sub: 'yes' }, 3)!.sub).toBeUndefined();
    savePhoneLink({ ...PH, sub: false });
    expect(phoneLink.value && phoneLink.value.sub).toBe(false);
    setPhoneSubscribed(true);
    expect(phoneLink.value && phoneLink.value.sub).toBe(true);

    savePhoneLink(PH);
    vi.resetModules();
    const again = await import('../../src/phone/phoneStore');
    expect(again.phoneLink.value).toMatchObject(PH);
  });

  it('rejects bad urls and tokens, keeps an empty name and cuts a long one', () => {
    const ok = { url: 'http://[fe80::1]:8097', token: 'c'.repeat(32), name: '' };
    expect(sanitizePhoneLink(ok, 7)).toEqual({ ...ok, at: 7 });
    expect(sanitizePhoneLink({ ...ok, url: 'http://evil.example/' })).toBeNull();
    expect(sanitizePhoneLink({ ...ok, url: 'http://1.2.3.4:8097/x' })).toBeNull();
    expect(sanitizePhoneLink({ ...ok, url: 'http://' + '1'.repeat(100) + ':1' })).toBeNull();
    expect(sanitizePhoneLink({ ...ok, token: 'C'.repeat(32) })).toBeNull();
    expect(sanitizePhoneLink({ ...ok, token: 'c'.repeat(31) })).toBeNull();
    expect(sanitizePhoneLink({ ...ok, name: 'x'.repeat(80) })!.name).toHaveLength(60);
    expect(sanitizePhoneLink({ url: ok.url, token: ok.token }, 1)!.name).toBe('');
  });

  it('an unchanged address only refreshes `at` in storage', () => {
    savePhoneLink(PH);
    const first = phoneLink.value;
    expect(first).toMatchObject(PH);
    savePhoneLink(PH);
    expect(phoneLink.value).toBe(first);
    savePhoneLink({ ...PH, url: 'http://192.168.1.21:8097' });
    expect(phoneLink.value!.url).toBe('http://192.168.1.21:8097');
    expect(JSON.parse(localStorage.getItem(PHONE_KEY)!).url).toBe('http://192.168.1.21:8097');
    savePhoneLink({ ...PH, token: 'bad' });
    expect(phoneLink.value!.url).toBe('http://192.168.1.21:8097');
  });

  it('accepts only a private-LAN host, the ranges the phone serves', () => {
    const tok = 'c'.repeat(32);
    const ok = (u: string) => sanitizePhoneLink({ url: u, token: tok, name: '' }, 1) !== null;
    expect(ok('http://10.1.2.3:8097')).toBe(true);
    expect(ok('http://172.16.0.9:8097')).toBe(true);
    expect(ok('http://172.31.255.1:8097')).toBe(true);
    expect(ok('http://192.168.0.5:1')).toBe(true);
    expect(ok('http://169.254.3.4:8097')).toBe(true);
    expect(ok('http://[fe80::1]:8097')).toBe(true);
    expect(ok('http://[fd12:3456::7]:8097')).toBe(true);
    expect(ok('http://[::ffff:192.168.1.4]:8097')).toBe(true);
    expect(ok('http://8.8.8.8:8097')).toBe(false);
    expect(ok('http://172.32.0.1:8097')).toBe(false);
    expect(ok('http://100.64.0.1:8097')).toBe(false);
    expect(ok('http://127.0.0.1:8097')).toBe(false);
    expect(ok('http://192.168.1.300:8097')).toBe(false);
    expect(ok('http://evil.example:8097')).toBe(false);
    expect(ok('http://192.168.1.4.evil:8097')).toBe(false);
    expect(ok('http://[2001:db8::1]:8097')).toBe(false);
    expect(ok('http://[::ffff:8.8.8.8]:8097')).toBe(false);
    expect(ok('http://192.168.1.4:0')).toBe(false);
    expect(ok('http://192.168.1.4:70000')).toBe(false);
    savePhoneLink({ url: 'http://8.8.8.8:8097', token: tok, name: 'x' });
    expect(phoneLink.value).toBeNull();
    expect(localStorage.getItem(PHONE_KEY)).toBeNull();
  });

  it('forgets the address', () => {
    savePhoneLink(PH);
    forgetPhoneLink();
    expect(phoneLink.value).toBeNull();
    expect(localStorage.getItem(PHONE_KEY)).toBeNull();
  });

  it('hides ads for a linked subscriber only inside the TTL, then falls back to free', () => {
    expect(PHONE_SUB_TTL_MS).toBe(6 * 60 * 60 * 1000);
    const fresh = sanitizePhoneLink({ ...PH, sub: true, at: 1_000, subAt: 5_000 });
    expect(phoneLinkSubscribed(fresh, 5_000 + PHONE_SUB_TTL_MS)).toBe(true);
    expect(phoneLinkSubscribed(fresh, 5_000 + PHONE_SUB_TTL_MS + 1)).toBe(false);
    // an old save has no subAt: the launch time is the stamp
    const legacy = sanitizePhoneLink({ ...PH, sub: true, at: 5_000 });
    expect(legacy && legacy.subAt).toBe(5_000);
    expect(phoneLinkSubscribed(legacy, 5_000 + 60_000)).toBe(true);
    expect(phoneLinkSubscribed(legacy, 5_000 + PHONE_SUB_TTL_MS + 1)).toBe(false);
    expect(phoneLinkSubscribed(sanitizePhoneLink({ ...PH, sub: false, at: 5_000 }), 5_000)).toBe(false);

    savePhoneLink({ ...PH, sub: true });
    const stamp = phoneLink.value && phoneLink.value.subAt;
    expect(typeof stamp).toBe('number');
    setPhoneSubscribed(true, (stamp || 0) + 1000);
    expect(phoneLink.value && phoneLink.value.subAt).toBe((stamp || 0) + 1000);
    expirePhoneSub((stamp || 0) + 1000 + PHONE_SUB_TTL_MS + 1);
    expect(phoneLink.value && phoneLink.value.sub).toBe(false);
    expect(phoneLinkSubscribed(phoneLink.value)).toBe(false);
  });
});
