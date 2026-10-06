// Display names of sources that are not registered here: on LG the built-in parsers live only on the phone, so a
// phone row's `source` / `sources` ids would otherwise show raw («nnmclub»). Names the phone sends (its `sources` RPC)
// win over the built-in table. The table mirrors builtinParsers() (src/sources/builtin.ts); a test keeps them in step.
// It is a plain map, so the LG bundle does not pull the parsers in. Chromium 53 safe.

/** id → name of every built-in parser, as in its Source definition. */
export const BUILTIN_SOURCE_NAMES: { [id: string]: string } = {
  rutor: 'rutor',
  nnmclub: 'NNM-Club',
  anidub: 'Anidub',
  bigfangroup: 'BigFANGroup',
  torrentby: 'torrent.by',
  rutracker: 'rutracker',
  kinozal: 'Kinozal',
  rustorka: 'rustorka',
};

let fromPhone: { [id: string]: string } = {};

/** Remembers the names the phone gave for its sources (they win over the built-in table). */
export function rememberSourceNames(list: { id: string; name: string }[]): void {
  const next: { [id: string]: string } = {};
  Object.keys(fromPhone).forEach((k) => {
    next[k] = fromPhone[k];
  });
  list.forEach((s) => {
    if (s && typeof s.id === 'string' && typeof s.name === 'string' && s.name) next[s.id] = s.name;
  });
  fromPhone = next;
}

/** The display name of an unregistered source id, or '' when unknown. */
export function knownSourceName(id: string): string {
  if (Object.prototype.hasOwnProperty.call(fromPhone, id)) return fromPhone[id];
  if (Object.prototype.hasOwnProperty.call(BUILTIN_SOURCE_NAMES, id)) return BUILTIN_SOURCE_NAMES[id];
  return '';
}

/** Test seam: forgets the phone's names. */
export function resetSourceNames(): void {
  fromPhone = {};
}
