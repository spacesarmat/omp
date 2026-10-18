// Whether TorrServer has a file list yet. A missing list (still getting info, or only a database row)
// is not the same as a list that arrived and has no audio. Pure.

export type FileListPhase = 'ready' | 'waiting' | 'empty';

/** preload / working / closed: the metadata read finished. added / getting info / in db: it has not. */
const METADATA_READY = [2, 3, 4];

export function fileListPhase(tor: { stat?: number; file_stats?: unknown[] | null } | null | undefined): FileListPhase {
  if (!tor) return 'waiting';
  const files = tor.file_stats;
  if (files && files.length > 0) return 'ready';
  if (typeof tor.stat === 'number' && METADATA_READY.indexOf(tor.stat) >= 0) return 'empty';
  return 'waiting';
}
