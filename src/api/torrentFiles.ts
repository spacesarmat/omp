// In-memory stash of .torrent files that OMP downloaded itself (an indexer link carries the API key, so TorrServer must
// never get that link). resolveLink hands out an `omp-file:<n>` pseudo-link; TorrServerClient.add uploads the bytes.
// Nothing here is persisted.
const PREFIX = 'omp-file:';
const MAX_FILES = 8;

let files: { id: string; bytes: Uint8Array }[] = [];
let counter = 0;

export function isStashedFile(link: string): boolean {
  return typeof link === 'string' && link.indexOf(PREFIX) === 0;
}

/** Keeps the bytes until the add takes them (the oldest are dropped past MAX_FILES). Returns the pseudo-link. */
export function stashFile(bytes: Uint8Array): string {
  counter += 1;
  const id = PREFIX + counter;
  files.push({ id, bytes });
  if (files.length > MAX_FILES) files = files.slice(files.length - MAX_FILES);
  return id;
}

/** The bytes of a pseudo-link, once; null when unknown. */
export function takeStashedFile(link: string): Uint8Array | null {
  for (let i = 0; i < files.length; i++) {
    if (files[i].id === link) {
      const b = files[i].bytes;
      files.splice(i, 1);
      return b;
    }
  }
  return null;
}
