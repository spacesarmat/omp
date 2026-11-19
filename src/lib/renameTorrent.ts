import type { Torrent } from '../api/types';
import { t } from '../i18n';
import { rememberRawTitle } from './keptQuality';
import { displayTitle } from './torrentName';
import { parseData, serializeData, withReleaseMeta } from './journal';
import { enqueueTorrentWrite } from './dataQueue';

export const TITLE_MAX = 200;

export type TitleCheck = { ok: true; title: string } | { ok: false; error: string };

/** A title typed by the user: trimmed, 1-200 characters. */
export function checkTitle(raw: string): TitleCheck {
  const title = (raw || '').replace(/\s+/g, ' ').trim();
  if (!title) return { ok: false, error: t('errors.enterTitle') };
  if (title.length > TITLE_MAX) return { ok: false, error: t('errors.titleTooLong', { max: TITLE_MAX }) };
  return { ok: true, title };
}

export interface RenameClient {
  setTitle(t: Pick<Torrent, 'hash' | 'poster' | 'category'>, title: string): Promise<void>;
  setData?(t: Pick<Torrent, 'hash' | 'title' | 'poster' | 'category'>, data: string): Promise<void>;
  list?(): Promise<Torrent[]>;
}

/** Renames a torrent. The previous release string stays in omp.rt, and omp.nm stops later cleanup. */
export function renameTorrent(c: RenameClient, tor: Pick<Torrent, 'hash' | 'poster' | 'category'> & { title?: string; data?: string }, raw: string): Promise<string> {
  const v = checkTitle(raw);
  if (!v.ok) return Promise.reject(new Error(v.error));
  rememberRawTitle(tor.hash, tor.title || '');
  const old = displayTitle(tor);
  const note = () => {
    if (!c.setData) return Promise.resolve();
    const read = c.list ? c.list().then(
      (all) => (all || []).filter((x) => !!x && String(x.hash).toLowerCase() === tor.hash.toLowerCase())[0] || null,
      () => null,
    ) : Promise.resolve(null);
    return read.then((cur) => {
      const base = cur || tor;
      const parsed = parseData(base.data);
      if (!parsed || !c.setData) return;
      const data = serializeData(withReleaseMeta(parsed.obj, old !== v.title ? old : '', true), parsed.journal);
      return c.setData({ hash: tor.hash, title: v.title, poster: base.poster || '', category: base.category || '' }, data).then(
        () => undefined,
        () => undefined,
      );
    });
  };
  return enqueueTorrentWrite(tor.hash, () => c.setTitle(tor, v.title)).then(() => {
    void enqueueTorrentWrite(tor.hash, note);
    return v.title;
  });
}
