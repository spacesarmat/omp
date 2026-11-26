import { beforeEach } from 'vitest';

/**
 * jsdom hands out Node's `URL.createObjectURL`, so the poster cache would fetch every picture through the network
 * inside UI tests. Without object URLs the cache steps aside and an `img` keeps the plain address, which is what
 * the screens did before it existed. Tests of the cache itself put the stub back.
 */
function withoutObjectUrls(): void {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: undefined });
}

withoutObjectUrls();

beforeEach(withoutObjectUrls);
