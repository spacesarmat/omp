import type { Torrent } from '../api/types';
import { t } from '../i18n';

export const TITLE_MAX = 200;

export type TitleCheck = { ok: true; title: string } | { ok: false; error: string };

/** A title typed by the user: trimmed, 1–200 characters. */
export function checkTitle(raw: string): TitleCheck {
  const title = (raw || '').replace(/\s+/g, ' ').trim();
  if (!title) return { ok: false, error: t('errors.enterTitle') };
  if (title.length > TITLE_MAX) return { ok: false, error: t('errors.titleTooLong', { max: TITLE_MAX }) };
  return { ok: true, title };
}

export interface RenameClient {
  setTitle(t: Pick<Torrent, 'hash' | 'poster' | 'category'>, title: string): Promise<void>;
}

/** Renames a torrent on the server (poster, category and data stay as stored); resolves with the saved title. */
export function renameTorrent(c: RenameClient, t: Pick<Torrent, 'hash' | 'poster' | 'category'>, raw: string): Promise<string> {
  const v = checkTitle(raw);
  if (!v.ok) return Promise.reject(new Error(v.error));
  return c.setTitle(t, v.title).then(() => v.title);
}
