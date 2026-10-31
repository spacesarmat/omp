// Android TV asks billing through the APK HTTP plugin. webOS has no plugin, so it uses XHR.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BILLING_ORIGIN } from '../../src/billing/config';

const native = { http: null as null | { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; clearCookies: () => Promise<void> } };

vi.mock('../../src/platform/androidNative', async (orig) => {
  const actual = await orig<typeof import('../../src/platform/androidNative')>();
  return { ...actual, nativeSourceHttp: () => native.http };
});

import { refreshTvAds, setTvAdsIo } from '../../src/ads/tvAds';
import { adEvent, flushAdEvents, resetAdEvents } from '../../src/ads/events';

const OFF = JSON.stringify({ v: 1, enabled: false, ttlSec: 300 });

class FakeXhr {
  method = '';
  url = '';
  status = 200;
  responseText = OFF;
  timeout = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {}
  send() {
    FakeXhr.sent.push({ method: this.method, url: this.url });
    if (this.onload) this.onload();
  }
  static sent: { method: string; url: string }[] = [];
}

beforeEach(() => {
  localStorage.clear();
  resetAdEvents();
  native.http = null;
  FakeXhr.sent = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  setTvAdsIo(null);
});

afterEach(() => {
  setTvAdsIo(null);
  resetAdEvents();
  vi.unstubAllGlobals();
});

describe('TV ads transport', () => {
  it('Android TV uses native HTTP for the config and for events', async () => {
    const get = vi.fn(async (url: string) => ({ status: 200, url, text: OFF }));
    const post = vi.fn(async () => ({ status: 204, url: '', text: '' }));
    native.http = { get, post, clearCookies: async () => undefined };
    await refreshTvAds(true);
    expect(get).toHaveBeenCalledWith(BILLING_ORIGIN + '/v1/ads-config', { timeoutMs: 10000 });
    expect(FakeXhr.sent).toEqual([]);
    adEvent('abc123', 'mine', 'androidTv', 'i');
    await flushAdEvents();
    expect(post).toHaveBeenCalledWith(BILLING_ORIGIN + '/v1/ads/event', { events: expect.any(String) }, { timeoutMs: 10000 });
    expect(FakeXhr.sent).toEqual([]);
  });

  it('webOS uses XHR for the config and for events', async () => {
    await refreshTvAds(true);
    expect(FakeXhr.sent).toEqual([{ method: 'GET', url: BILLING_ORIGIN + '/v1/ads-config' }]);
    adEvent('abc123', 'mine', 'webos', 'c');
    await flushAdEvents();
    expect(FakeXhr.sent[1]).toEqual({ method: 'POST', url: BILLING_ORIGIN + '/v1/ads/event' });
  });
});
