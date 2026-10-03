import { describe, it, expect } from 'vitest';
import { scrub } from '../../src/lib/log';

describe('scrub: bare host names', () => {
  it('single-label host with a port', () => {
    expect(scrub('connect to myhost:8090 failed')).toBe('connect to сервер failed');
    expect(scrub('connect to torrserver:8090 failed')).toBe('connect to сервер failed');
  });
  it('keeps code locations, times and versions', () => {
    expect(scrub('at foo.kt:12345 boom')).toBe('at foo.kt:12345 boom');
    expect(scrub('at 12:30:05 v0.14.0')).toBe('at 12:30:05 v0.14.0');
    expect(scrub('0.14.0:5555')).toBe('0.14.0:5555');
  });
  it('Java host/ip form', () => {
    expect(scrub('failed to connect to myhost/192.168.1.5 (port 8090)')).toBe('failed to connect to сервер/IP (port 8090)');
  });
  it('unquoted resolve host', () => {
    expect(scrub('Unable to resolve host myhost: No address')).toBe('Unable to resolve host "сервер": No address');
  });
});
