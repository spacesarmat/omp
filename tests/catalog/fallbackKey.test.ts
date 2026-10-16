import { describe, it, expect, vi } from 'vitest';
import { TMDB_FALLBACK_KEY, setTmdbFallbackKeyForTests } from '../../src/catalog/fallbackKey';

// The app tsconfig has no @types/node. Tests still read the env the setup stubs.
declare const process: { env: { TMDB_API_KEY?: string } };

describe('built-in TMDB key in tests', () => {
  it('stays empty even when the process was given TMDB_API_KEY', () => {
    vi.stubEnv('TMDB_API_KEY', '0123456789abcdef0123456789abcdef');
    expect(process.env.TMDB_API_KEY).toBe('0123456789abcdef0123456789abcdef');
    expect(TMDB_FALLBACK_KEY).toBe('');
  });

  it('drops a key baked in before this test', () => {
    expect(TMDB_FALLBACK_KEY).toBe('');
    setTmdbFallbackKeyForTests('baked-from-env');
    expect(TMDB_FALLBACK_KEY).toBe('baked-from-env');
  });

  it('starts empty again on the next test', () => {
    expect(TMDB_FALLBACK_KEY).toBe('');
    expect(process.env.TMDB_API_KEY || '').toBe('');
  });
});
