// Several releases of one thing in «Мои» — INFORMATION ONLY: the series screen lists a season's releases with their
// quality, episode (or file) count and size, and an add of a release that is already there says so in a toast.
// Nothing is ever deleted from here: the user deletes by hand from the release's menu, with its usual confirm.
import type { Torrent } from '../../../src/api/types';
import { qualityLabel } from '../../../src/monitor/quality';
import { libraryKey } from '../../../src/catalog/library';
import { titleCore } from '../../../src/lib/posterSearch';
import { displayTitle } from '../../../src/lib/torrentName';
import { shortTitle } from '../../../src/lib/libraryView';
import { contentsText } from './releaseContents';
import { torrents } from '../../../src/store/library';
import { fmtSize, t } from '../../../src/i18n';
import { groupLibrary, isSeries, seasonMembers, type SeriesGroup } from '../../../src/lib/seriesGroups';

export { contentsText };

/** A release named for its menu: «Повелитель духов · 4K WEB-DL» (the series name, then the release's quality). */
export function releaseName(tor: Torrent, name: string): string {
  const own = shortTitle(displayTitle(tor));
  return [name || own, qualityLabel(displayTitle(tor))].filter(Boolean).join(' · ');
}

/** «4K WEB-DL · 18 серий · 9,7 ГБ» (the parts known). */
export function releaseLine(tor: Torrent, withContents = true): string {
  return [
    qualityLabel(displayTitle(tor)) || shortTitle(displayTitle(tor)),
    withContents ? contentsText(tor) : '',
    tor.torrent_size ? fmtSize(tor.torrent_size) : '',
  ].filter(Boolean).join(' · ');
}

/** The title and year keys of a film: the names before the first « (» or « [», with the release year; none without a year. */
export function filmKeys(tor: Torrent): string[] {
  const raw = displayTitle(tor);
  const field = /[\[(](?:[^\])]*[^0-9\])])?((?:19|20)\d\d)(?![0-9])/.exec(raw);
  const any = field ? null : /(?:^|[^0-9x])((?:19|20)\d\d)(?![0-9xp])/i.exec(raw);
  const year = field ? +field[1] : any ? +any[1] : 0;
  if (!year) return [];
  let head = raw;
  [' (', ' ['].forEach((sep) => {
    const at = head.indexOf(sep);
    if (at > 0) head = head.slice(0, at);
  });
  const out: string[] = [];
  head.split(' / ').forEach((part) => {
    const core = titleCore(part);
    const k = core ? libraryKey(core, year) : '';
    if (k && out.indexOf(k) < 0) out.push(k);
  });
  return out;
}

function groupOf(list: Torrent[], tor: Torrent): SeriesGroup | null {
  const items = groupLibrary(list);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'series' && it.members.indexOf(tor) >= 0) return it;
  }
  return null;
}

/** The other releases of the same thing: a series release of the same season, or a film with the same title and year. */
export function sameReleases(list: Torrent[], tor: Torrent): Torrent[] {
  const key = tor.hash.toLowerCase();
  const others = list.filter((x) => x.hash.toLowerCase() !== key);
  if (isSeries(tor)) {
    const g = groupOf(others.concat([tor]), tor);
    if (!g) return [];
    const out: Torrent[] = [];
    g.seasons.forEach((s) => {
      const here = seasonMembers(g, s);
      if (here.indexOf(tor) < 0) return;
      here.forEach((m) => {
        if (m !== tor && out.indexOf(m) < 0) out.push(m);
      });
    });
    return out;
  }
  const keys = filmKeys(tor);
  if (!keys.length) return [];
  return others.filter((x) => !isSeries(x) && filmKeys(x).some((k) => keys.indexOf(k) >= 0));
}

/** After an add: the toast text when the library already has this release («Такая раздача уже есть: 4K · 9,7 ГБ»); '' otherwise. */
export function alreadyHaveText(hash: string, title: string, category?: string): string {
  const list = torrents.peek();
  const fresh = list.filter((x) => x.hash.toLowerCase() === hash.toLowerCase())[0] || ({ hash, title, category: category || '' } as Torrent);
  const same = sameReleases(list.indexOf(fresh) >= 0 ? list : list.concat([fresh]), fresh);
  return same.length ? t('series.alreadyHave', { info: releaseLine(same[0], false) }) : '';
}
