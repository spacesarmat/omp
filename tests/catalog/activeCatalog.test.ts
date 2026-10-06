import { describe, it, expect, afterEach } from 'vitest';
import { setCatalogProvider, activeCatalog } from '../../src/catalog/activeCatalog';
import { catalogErrorCode } from '../../src/catalog/client';
describe('activeCatalog', () => {
  afterEach(() => setCatalogProvider(null));
  it('rejects as nokey without a provider', async () => {
    await expect(activeCatalog()).rejects.toSatisfy((e: unknown) => catalogErrorCode(e) === 'nokey');
  });
  it('returns the registered client', async () => {
    const c = { novelties: () => null } as never;
    setCatalogProvider(() => Promise.resolve(c));
    expect(await activeCatalog()).toBe(c);
  });
});
