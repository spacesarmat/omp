import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
// Plain Node modules. tsc has no declaration for them; the tests call the real exports.
// @ts-expect-error no types for the packaging script
import { storeAppInfo, STORE_REQUIRED_ACG } from '../../scripts/store-appinfo.mjs';
// @ts-expect-error no types for the packaging script
import { decodePng, flattenToOpaquePng, transparentPixels, ICON_BG } from '../../scripts/png-opaque.mjs';
// @ts-expect-error no types for the packaging script
import { scanStoreBundle } from '../../scripts/store-bundle-check.mjs';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 2x1 RGBA: left pixel transparent, right pixel opaque red. */
function samplePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.from([0, 0, 0, 0, 0, 255, 0, 0, 255]);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('store appinfo', () => {
  const appinfo = JSON.parse(readFileSync('webos/appinfo.json', 'utf8'));

  it('declares only network.query and drops a stray requiredACG', () => {
    const info = storeAppInfo({ ...appinfo, requiredACG: ['settings.query', 'application.launcher'] }, '0.30.1-beta.13');
    expect(info.requiredACG).toEqual(STORE_REQUIRED_ACG);
    expect(info.requiredACG).toEqual(['network.query']);
    expect(info.version).toBe('0.30.1');
    expect(info.id).toBe('com.spacesarmat.torrplayer');
    expect(info.splashBackground).toBeUndefined();
    expect(info.bgImage).toBeUndefined();
  });

  it('refuses a splash or launcher image that has not been flattened', () => {
    expect(() => storeAppInfo({ ...appinfo, splashBackground: 'splash.png' }, '0.30.1')).toThrow(/splash/);
  });
});

describe('opaque store icons', () => {
  it('composites transparent pixels onto #181B22 and writes RGB', () => {
    const flat = flattenToOpaquePng(samplePng(), ICON_BG);
    expect(flat.transparent).toBe(1);
    expect(flat.width).toBe(2);
    expect(flat.height).toBe(1);
    expect(transparentPixels(flat.png).transparent).toBe(0);
    const pixels = decodePng(flat.png).rgba;
    expect([pixels[0], pixels[1], pixels[2], pixels[3]]).toEqual([ICON_BG.r, ICON_BG.g, ICON_BG.b, 255]);
    expect([pixels[4], pixels[5], pixels[6], pixels[7]]).toEqual([255, 0, 0, 255]);
  });

  it('webos icon and largeIcon are 80 and 130 and fully opaque', () => {
    const icon = transparentPixels(readFileSync('webos/icon.png'));
    const large = transparentPixels(readFileSync('webos/largeIcon.png'));
    expect(icon).toEqual({ width: 80, height: 80, transparent: 0 });
    expect(large).toEqual({ width: 130, height: 130, transparent: 0 });
  });

  it('the beta band icons are opaque too: LG paints a light card behind transparent pixels', () => {
    const icon = transparentPixels(readFileSync('webos/beta/icon.png'));
    const large = transparentPixels(readFileSync('webos/beta/largeIcon.png'));
    expect(icon).toEqual({ width: 80, height: 80, transparent: 0 });
    expect(large).toEqual({ width: 130, height: 130, transparent: 0 });
  });
});

describe('store bundle luna strings', () => {
  it('flags homebrew and dev-mode calls and requires the calls the store keeps', () => {
    const bad = scanStoreBundle('luna://org.webosbrew.hbchannel.service/install luna://com.webos.media/selectTrack');
    expect(bad.banned).toContain('org.webosbrew');
    expect(bad.missing).toContain('luna://com.webos.service.connectionmanager/getStatus');
    const good = scanStoreBundle(
      'luna://com.webos.service.connectionmanager/getStatus luna://com.webos.media/selectTrack luna://com.webos.media/setSubtitleEnable',
    );
    expect(good).toEqual({ banned: [], missing: [] });
  });
});
