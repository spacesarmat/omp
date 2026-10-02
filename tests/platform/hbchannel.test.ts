import { describe, it, expect, afterEach, vi } from 'vitest';
import { hbPresence, hbHasRoot, openHbChannel, hbInstall, installStatus, HB_APP_ID } from '../../src/platform/hbchannel';

type Reply = (uri: string, params: any) => object[];
let calls: { uri: string; params: any }[] = [];

function fakeBridge(reply: Reply) {
  calls = [];
  (window as any).PalmServiceBridge = function (this: any) {
    this.call = (uri: string, params: string) => {
      const p = JSON.parse(params);
      calls.push({ uri, params: p });
      const msgs = reply(uri, p);
      msgs.forEach((m, i) => setTimeout(() => this.onservicecallback(JSON.stringify(m)), i));
    };
    this.cancel = vi.fn();
  };
}

afterEach(() => { delete (window as any).PalmServiceBridge; });

describe('hbchannel', () => {
  it('detects Homebrew Channel presence', async () => {
    fakeBridge(() => [{ returnValue: true, appInfo: { id: HB_APP_ID } }]);
    expect(await hbPresence()).toBe('installed');
    expect(calls[0]).toEqual({ uri: 'luna://com.webos.applicationManager/getAppInfo', params: { id: 'org.webosbrew.hbchannel' } });
    fakeBridge(() => [{ returnValue: false, errorText: 'Cannot find app: org.webosbrew.hbchannel (not exist)' }]);
    expect(await hbPresence()).toBe('missing');
    fakeBridge(() => [{ returnValue: false, errorText: 'Denied method call' }]);
    expect(await hbPresence()).toBe('unknown');
    delete (window as any).PalmServiceBridge;
    expect(await hbPresence()).toBe('unknown');
  });
  it('checks root through the Homebrew Channel service', async () => {
    fakeBridge(() => [{ returnValue: true }]);
    expect(await hbHasRoot()).toBe(true);
    expect(calls[0].uri).toBe('luna://org.webosbrew.hbchannel.service/checkRoot');
    fakeBridge(() => [{ returnValue: false }]);
    expect(await hbHasRoot()).toBe(false);
  });
  it('opens Homebrew Channel, optionally on the add-repository screen', async () => {
    fakeBridge(() => [{ returnValue: true }]);
    await openHbChannel('https://x/apps.json');
    expect(calls[0]).toEqual({
      uri: 'luna://com.webos.applicationManager/launch',
      params: { id: 'org.webosbrew.hbchannel', params: { launchMode: 'addRepository', url: 'https://x/apps.json' } },
    });
    fakeBridge(() => [{ returnValue: true }]);
    await openHbChannel();
    expect(calls[0].params).toEqual({ id: 'org.webosbrew.hbchannel', params: {} });
  });
  it('maps install progress messages', () => {
    expect(installStatus({ statusText: 'Downloading…', progress: 42.4 })).toEqual({ stage: 'download', progress: 42, text: 'Скачивание… 42%' });
    expect(installStatus({ statusText: 'Downloading…' })).toEqual({ stage: 'download', text: 'Скачивание…' });
    expect(installStatus({ statusText: 'Verifying…' })).toEqual({ stage: 'verify', text: 'Проверка…' });
    expect(installStatus({ statusText: 'Installing…' })).toEqual({ stage: 'install', text: 'Установка…' });
    expect(installStatus({ statusText: 'Finished.', finished: true })).toEqual({ stage: 'done', text: 'Готово. Откройте OMP заново' });
  });
  it('streams install status and errors', async () => {
    fakeBridge(() => [
      { returnValue: true, statusText: 'Downloading…', progress: 10 },
      { returnValue: true, statusText: 'Verifying…' },
      { returnValue: true, statusText: 'Finished.', finished: true },
    ]);
    const seen: string[] = [];
    const onError = vi.fn();
    hbInstall('https://x/a.ipk', 'f'.repeat(64), (s) => seen.push(s.stage), onError);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls[0]).toEqual({ uri: 'luna://org.webosbrew.hbchannel.service/install', params: { ipkUrl: 'https://x/a.ipk', ipkHash: 'f'.repeat(64), subscribe: true } });
    expect(seen).toEqual(['download', 'verify', 'done']);
    expect(onError).not.toHaveBeenCalled();

    fakeBridge(() => [{ returnValue: false, errorText: 'Invalid file checksum' }]);
    const err = vi.fn();
    hbInstall('https://x/a.ipk', 'f'.repeat(64), () => undefined, err);
    await new Promise((r) => setTimeout(r, 10));
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][0].message).toBe('Invalid file checksum');
  });
  it('reports a missing Luna bridge as an install error', () => {
    const err = vi.fn();
    hbInstall('https://x/a.ipk', 'f'.repeat(64), () => undefined, err);
    expect(err).toHaveBeenCalledTimes(1);
  });
});
