// «Добавить» of a found release (unified search, the «Новое» feed, subscription findings): the link is taken from the
// release page when the row has none (nnmclub, rutracker; Anidub and BigFANGroup give an http(s) .torrent link), then
// the torrent is added to the active server and its poster looked up.
import { client } from '../../src/store/servers';
import { rememberAdded } from '../../src/store/library';
import { resolveLink } from '../../src/sources/view';
import type { SourceResult } from '../../src/sources/types';
import { phoneSourceContext } from './searchContext';
import { t } from '../../src/i18n';

/** Row state while adding: taking the link from the release page, then adding. */
export type RowBusy = 'link' | 'add';

/**
 * Adds `r` with `category`; resolves with the new torrent's hash, or null when `alive()` turned false after the link
 * was taken (the screen was left: nothing is added). Rejects with the error to show.
 */
export async function addSearchResult(
  r: SourceResult,
  category: string,
  o?: { onStep?: (s: RowBusy) => void; alive?: () => boolean },
): Promise<string | null> {
  const c = client.value;
  if (!c) throw new Error(t('errors.noServerSelected'));
  o?.onStep?.('link');
  const l = await resolveLink(r, phoneSourceContext());
  if (o?.alive && !o.alive()) return null;
  o?.onStep?.('add');
  const added = await c.add({ link: l, title: r.Title, category });
  void rememberAdded(c, added, r.Title);
  return added.hash;
}
