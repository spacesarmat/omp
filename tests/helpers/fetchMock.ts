import { vi } from 'vitest';

export interface MockResponse {
  status?: number;
  body: string;
}

export function mockFetch(handler: (url: string, init: any) => MockResponse | Promise<MockResponse>) {
  const fn = vi.fn((url: string, init?: any) =>
    Promise.resolve(handler(url, init || {})).then((r) => {
      const status = r.status === undefined ? 200 : r.status;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(r.body),
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(r.body).buffer),
      };
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}
