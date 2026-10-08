// The text parts of a found-release row, shared by the phone and the TV: the short title with its meta
// («Тёмная материя · 2 сезон · серии 1–6 из 10») and the quality chips. Pure; Chromium 53 safe.
import { libraryTitle, type LibraryTitle } from '../lib/libraryView';
import { displayBadge, parseReleaseInfo } from '../lib/releaseInfo';
import { parseRelease } from './filters';
import { releaseKind, type KindFilter, type KindInput, type ReleaseKind } from '../lib/releaseKind';
import { t } from '../i18n';

/** «Звездный путь: Странные новые миры» + «1–4 сезоны · серии 1–40 из 40» from a tracker title. */
export function releaseTitle(raw: string): LibraryTitle {
  return libraryTitle({ hash: '', title: raw || '' });
}

/** Quality chips: resolution, HDR, source and voice-over, e.g. ['4K', 'HDR', 'WEB-DL', 'Дубляж']. */
export function releaseChips(raw: string): string[] {
  const info = parseReleaseInfo(raw || '');
  const out: string[] = [];
  if (info.resolution) out.push(displayBadge(info.resolution));
  if (info.hdr) out.push(info.hdr);
  if (info.source) out.push(info.source);
  const r = parseRelease(raw || '');
  if (r.dub) out.push(t('filters.dubChip'));
  else if (r.mvo) out.push(t('filters.mvoChip'));
  else if (r.original) out.push(t('filters.originalChip'));
  return out;
}

/** A chip worth the accent colour: 4K / 2160p, any HDR, Dolby Vision, Remux. */
export function isHotChip(chip: string): boolean {
  return /^(4K|2160p|HDR.*|DV|Dolby Vision|Remux)$/i.test(chip || '');
}

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

/**
 * The kind badge of a result: «Фильм», «Сериал», «Сериал · S01», «Сериал · S01–S03», «Сериал · S02 · 1–8 из 8»; ''
 * when the kind is unknown (no badge).
 */
export function kindLabel(k: ReleaseKind): string {
  if (k.kind === 'movie') return t('search.kind.movie');
  if (k.kind !== 'series') return '';
  const parts = [t('search.kind.series')];
  const s = k.season;
  if (typeof s === 'number') parts.push('S' + pad2(s));
  else if (s) parts.push('S' + pad2(s[0]) + '–S' + pad2(s[1]));
  const e = k.episodes;
  if (e) {
    if (e.from === e.to) parts.push(t('search.kind.episode', { n: e.from }));
    else if (e.total !== undefined) parts.push(t('search.kind.episodesOf', { from: e.from, to: e.to, total: e.total }));
    else parts.push(t('search.kind.episodes', { from: e.from, to: e.to }));
  }
  return parts.join(' · ');
}

/** The kind badge of a search result ('' for none). */
export function resultKindLabel(r: KindInput): string {
  return kindLabel(releaseKind(r));
}

/** «Все / Фильмы / Сериалы»: the options of the kind filter. */
export const kindFilterOptions = (): { id: KindFilter; label: string }[] => [
  { id: 'all', label: t('search.kind.all') },
  { id: 'movie', label: t('search.kind.movies') },
  { id: 'series', label: t('search.kind.seriesMany') },
];
