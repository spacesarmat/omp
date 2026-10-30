// «+3 озвучки, субтитры»: the external dubs and subtitles a release holds (src/lib/externalTracks.ts), for the release
// lists on the phone and the TV. '' when there are none.
import { t, tp } from '../i18n';
import type { TorrentFile } from './episodes';
import { externalSummary } from './externalTracks';

export function externalNoteText(files: TorrentFile[] | null | undefined): string {
  const s = externalSummary(files);
  if (s.dubs > 0) return tp(s.subtitles ? 'library.extDubsSubs' : 'library.extDubs', s.dubs);
  return s.subtitles ? t('library.extSubs') : '';
}
