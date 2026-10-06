// The text parts of a found-release row, shared by the phone and the TV: the short title with its meta
// («Тёмная материя · 2 сезон · серии 1–6 из 10») and the quality chips. Pure; Chromium 53 safe.
import { libraryTitle, type LibraryTitle } from '../lib/libraryView';
import { displayBadge, parseReleaseInfo } from '../lib/releaseInfo';
import { parseRelease } from './filters';
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
