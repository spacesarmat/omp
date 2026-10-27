// «Кнопка по контексту»: with no TV chosen the main action of a title plays it on this phone, «На ТВ» comes second.
import { activeTv } from './tv/tvStore';
import { client } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { getLocalProgress } from '../../src/store/progress';
import { sharedResume } from './lib/sharedProgress';
import { baseName, episodeLabel, stripExt, type TorrentFile } from '../../src/lib/episodes';
import { formatDuration } from '../../src/lib/format';
import { t } from '../../src/i18n';
import type { Torrent } from '../../src/api/types';
import { watchOnPhone } from './watch';

/** The main action goes to the TV: one is chosen (paired). Without one it plays on the phone. */
export function tvFirst(): boolean {
  return !!activeTv.value;
}

/**
 * Plays `file` of `tor` on this phone from where it was left (`at`, else the shared position). `tor` may be a hash of
 * the library. Rejects with the error to show.
 */
export async function playOnPhone(tor: Torrent | string, file: TorrentFile, at?: number): Promise<void> {
  const c = client.peek();
  const it = typeof tor === 'string' ? torrents.peek().find((x) => x.hash === tor) : tor;
  if (!c || !it) return;
  await watchOnPhone(c, it, {
    hash: it.hash,
    file,
    title: stripExt(baseName(file.path)),
    at: at !== undefined ? at : sharedResume(it.hash, file.id),
    duration: getLocalProgress(it.hash, file.id)?.duration || 0,
  });
}

/** «Смотреть на телефоне · S01E03» / «Продолжить на телефоне · S01E03 с 12:30». */
export function phoneLabel(file: TorrentFile | undefined, at: number, withEpisode = true): string {
  const ep = file && withEpisode ? episodeLabel(file.path) : '';
  if (at > 0) return t('nav.continueOnPhone', { ep: ep ? ep + ' ' : '', time: formatDuration(at) });
  return ep ? t('nav.watchOnPhoneEp', { ep }) : t('nav.watchOnPhone');
}
