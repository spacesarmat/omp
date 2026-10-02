function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    // storage unavailable
  }
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Reads JSON from localStorage; corrupt or invalid values are removed and replaced by the fallback. */
export function loadJson<T>(key: string, fallback: T, isValid?: (v: unknown) => boolean): T {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch (e) {
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    const v = JSON.parse(raw);
    if (isValid && !isValid(v)) {
      removeKey(key);
      return fallback;
    }
    return v as T;
  } catch (e) {
    removeKey(key);
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // storage full or unavailable — state stays in memory
  }
}
