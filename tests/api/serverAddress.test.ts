import { describe, it, expect } from 'vitest';
import { addressErrorText, addressForField, checkServerAddress, cleanAddressText, showChar } from '../../src/api/serverAddress';
import { normalizeServerUrl } from '../../src/api/torrserver';
import { normalizeIndexerUrl } from '../../src/sources/indexerStore';
import { normalizeFlareUrl } from '../../src/sources/flareStore';

const url = (s: string) => {
  const c = checkServerAddress(s);
  return c.ok ? c.url : 'BAD:' + c.bad;
};

describe('checkServerAddress: what TV keyboards type', () => {
  it('plain addresses: scheme and the 8090 port added only when neither is typed', () => {
    expect(url('192.168.1.124:8090')).toBe('http://192.168.1.124:8090');
    expect(url('192.168.1.124')).toBe('http://192.168.1.124:8090');
    expect(url('192.168.1.124:5665/')).toBe('http://192.168.1.124:5665');
    expect(url('http://192.168.1.124:8090/')).toBe('http://192.168.1.124:8090');
    expect(url('HTTP://192.168.1.124:8090//')).toBe('http://192.168.1.124:8090');
    expect(url('https://ts.example.com')).toBe('https://ts.example.com');
    expect(url('https://ts.example.com/torr/')).toBe('https://ts.example.com/torr');
    expect(url('my-nas.local')).toBe('http://my-nas.local:8090');
  });

  it('a full-width colon, digits and dots (the Mi TV keyboard)', () => {
    expect(url('192.168.1.124\uFF1A8090')).toBe('http://192.168.1.124:8090');
    expect(url('\uFF11\uFF19\uFF12\uFF0E\uFF11\uFF16\uFF18\uFF0E\uFF11\uFF0E\uFF11\uFF12\uFF14\uFF1A\uFF18\uFF10\uFF19\uFF10')).toBe('http://192.168.1.124:8090');
    expect(url('192\u3002168\u30021\u3002124:8090')).toBe('http://192.168.1.124:8090');
  });

  it('NBSP, zero-width and other invisible characters, spaces anywhere', () => {
    expect(url('192.168.1.124:8090\u00A0')).toBe('http://192.168.1.124:8090');
    expect(url('\u200B192.168.1.124:\u200B8090')).toBe('http://192.168.1.124:8090');
    expect(url('\uFEFF192.168.1.124 : 8090\u200E')).toBe('http://192.168.1.124:8090');
    expect(url('192.168.1.124\u3000:8090')).toBe('http://192.168.1.124:8090');
  });

  it('a comma for a dot in the host', () => {
    expect(url('192,168,1,124:8090')).toBe('http://192.168.1.124:8090');
    expect(url('192.168.1,124')).toBe('http://192.168.1.124:8090');
    expect(url('192.168.1.124,')).toBe('http://192.168.1.124:8090');
  });

  it('Cyrillic о/О/з for 0/3 only in an IP and a port', () => {
    expect(url('192.168.1.1\u043E4:8\u041E9\u043E')).toBe('http://192.168.1.104:8090');
    expect(url('192.168.\u0437.124')).toBe('http://192.168.3.124:8090');
    // a hostname keeps its letters: the Cyrillic one is reported
    expect(url('t\u043Errserver.local')).toBe('BAD:\u043E');
  });

  it('still not an address: names the character, or none when the shape is wrong', () => {
    expect(url('192.168.1.124;8090')).toBe('BAD:;');
    expect(url('192.168.1.124:80a0')).toBe('BAD:a');
    expect(url('\u0441\u0435\u0440\u0432\u0435\u0440:8090')).toBe('BAD:\u0441');
    expect(url('192.168.1:8090')).toBe('BAD:');
    expect(url('192.168.1.300')).toBe('BAD:');
    expect(url('192.168.1.124:')).toBe('BAD:');
    expect(url('192.168.1.124:70000')).toBe('BAD:');
    expect(url('ftp://192.168.1.124')).toBe('BAD:');
  });

  it('IPv6 in brackets and credentials pass through', () => {
    expect(url('[fe80::1]:8090')).toBe('http://[fe80::1]:8090');
    expect(url('http://user:pw@ts.local:8090')).toBe('http://user:pw@ts.local:8090');
  });
});

describe('cleanup helpers', () => {
  it('cleanAddressText only drops look-alikes and invisible characters', () => {
    expect(cleanAddressText(' http://Host\u00A0:\uFF18\uFF10\uFF19\uFF10/ ')).toBe('http://Host:8090/');
  });
  it('the error names the character; invisible ones as U+XXXX', () => {
    expect(addressErrorText(';')).toBe('В адресе есть недопустимый символ: «;»');
    expect(addressErrorText('')).toContain('Неверный адрес');
    expect(showChar('\u0085')).toBe('U+0085');
  });
  it('the field shows the address without http://', () => {
    expect(addressForField('http://192.168.1.124:8090')).toBe('192.168.1.124:8090');
    expect(addressForField('https://ts.local')).toBe('https://ts.local');
  });
  it('normalizeServerUrl, Jackett/Prowlarr and FlareSolverr addresses are cleaned too', () => {
    expect(normalizeServerUrl('192.168.1.124\uFF1A8090\u00A0')).toBe('http://192.168.1.124:8090');
    expect(normalizeIndexerUrl('http://192.168.1.5\uFF1A9117\u200B')).toBe('http://192.168.1.5:9117');
    expect(normalizeFlareUrl('192.168.1.5\uFF1A8191 ')).toBe('http://192.168.1.5:8191');
  });
});
