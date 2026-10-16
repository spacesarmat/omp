// A TMDB v4 access token is a JWT (header.payload.signature). The v3 API key is a short string and is sent as
// api_key. Pasting the v4 token into the API-key field makes TMDB answer 401 unless it goes out as a bearer token.

/** True when `key` has the shape of a TMDB v4 access token (a JWT whose header starts with eyJ). */
export function isTmdbV4Token(key: string): boolean {
  const parts = (key || '').split('.');
  if (parts.length !== 3) return false;
  if (parts[0].indexOf('eyJ') !== 0) return false;
  for (let i = 0; i < 3; i++) {
    if (!parts[i] || !/^[A-Za-z0-9_-]+$/.test(parts[i])) return false;
  }
  return true;
}
