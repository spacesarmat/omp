// «Добавить» of a found release (unified search, the «Новое» feed, subscription findings): the link is taken from the
// release page when the row has none (nnmclub, rutracker; Anidub and BigFANGroup give an http(s) .torrent link), then
// the torrent is added to the active server and its poster looked up.
import { client } from '../../src/store/servers';
import { checkCategories, rememberAdded } from '../../src/store/library';
import { saveCategoryPicked } from '../../src/store/journal';
import { resolveLink } from '../../src/sources/view';
import type { SourceResult } from '../../src/sources/types';
import type { Torrent } from '../../src/api/types';
import { phoneSourceContext } from './searchContext';
import { t } from '../../src/i18n';
import { checkAddedDuplicate } from './lib/duplicates';

/** Row state while adding: taking the link from the release page, then adding. */
export type RowBusy = 'link' | 'add';

/**
 * Adds `r` with `category`; resolves with the new torrent's hash, or null when `alive()` turned false after the link
 * was taken (the screen was left: nothing is added). Rejects with the error to show.
 */
export async function addSearchResult(
  r: SourceResult,
  category: string,
  o?: { onStep?: (s: RowBusy) => void; alive?: () => boolean; picked?: boolean },
): Promise<string | null> {
  const c = client.value;
  if (!c) throw new Error(t('errors.noServerSelected'));
  o?.onStep?.('link');
  const l = await resolveLink(r, phoneSourceContext());
  if (o?.alive && !o.alive()) return null;
  o?.onStep?.('add');
  const added = await c.add({ link: l, title: r.Title, category });
  void rememberAdded(c, added, r.Title);
  afterAdd(c, added, !!(o && o.picked));
  // a duplicate of a release already in «Мои»: offer to keep the better one
  checkAddedDuplicate(added.hash, r.Title, category);
  return added.hash;
}

/**
 * After an add: a category picked by hand is marked (omp.cm) so the automatic check leaves it; otherwise the check
 * looks at the title now (the files come later, with the library refresh).
 */
export function afterAdd(c: NonNullable<typeof client.value>, added: Torrent, picked: boolean): void {
  if (!added || !added.hash) return;
  if (picked) void saveCategoryPicked(c, added).catch(() => undefined);
  else void checkCategories(c, [added]);
}
