// «Озвучка» row of the series screen (TV and phone): the dub remembered for the series from the players, the dubs
// seen in its files to switch to, and «По умолчанию (сбросить)». Read from the library copy of the torrents (the
// journal writes patch it), written to TorrServer through the watch journal.
import { useState } from 'preact/hooks';
import { t } from '../i18n';
import type { Torrent } from '../api/types';
import { LANG_OPTIONS } from '../lib/tracks';
import { isReset, newestSeriesTracks, sameDub, seriesTracksOf, type SeriesTracks, type SeriesTracksPatch } from '../lib/seriesTracks';
import { saveSeriesTracks, type JournalClient } from '../store/journal';

export const DUB_RESET = 'reset';

export interface DubChoice {
  label: string;
  value: string;
}

/** The language name of a code («ru» → «Русский»), the code itself when unknown. */
function langName(code: string): string {
  const o = LANG_OPTIONS.filter((x) => x.value === code)[0];
  return o ? o.label : code.toUpperCase();
}

/** A channel layout as shown: «5.1», «7.1», «стерео» (2.0), «моно» (1.0); '' when unknown. */
export function channelsName(c: string | undefined): string {
  if (!c) return '';
  if (c === '2.0') return t('series.dubStereo');
  if (c === '1.0') return t('series.dubMono');
  return c;
}

const withChannels = (l: string, c: string | undefined) => (channelsName(c) ? l + ' · ' + channelsName(c) : l);

/** The channels of the remembered dub: its own, else the ones seen with that dub (an older record has none). */
function recChannels(rec: SeriesTracks): string {
  if (rec.c) return rec.c;
  const seen = (rec.k || []).filter((s) => sameDub(s.l, rec.l))[0];
  return seen && seen.c ? seen.c : '';
}

/** «HDRezka · 5.1», «LostFilm», «Русский» (a language without a dub title), «по умолчанию». */
export function dubText(rec: SeriesTracks | null): string {
  if (!rec || isReset(rec) || (!rec.l && !rec.g)) return t('series.dubDefault');
  return rec.l ? withChannels(rec.l, recChannels(rec)) : langName(rec.g || '');
}

/** The value of the remembered dub among [dubChoices] (DUB_RESET when there is none). */
export function dubValue(rec: SeriesTracks | null): string {
  if (!rec || (!rec.l && !rec.g)) return DUB_RESET;
  // a language without a dub title (an untitled track picked by hand): its own entry
  if (!rec.l) return 'g:' + rec.g;
  const k = rec.k || [];
  for (let i = 0; i < k.length; i++) if (sameDub(k[i].l, rec.l)) return 'k' + i;
  return 'l';
}

/** «HDRezka · 5.1 · Русский»: the dub, its channels when known, its language. */
const seenLabel = (l: string, g: string | undefined, c?: string) => (g ? withChannels(l, c) + ' · ' + langName(g) : withChannels(l, c));

/**
 * The dubs seen in the series' files, the remembered one when it is not among them (a dub title, or a language
 * alone), then «По умолчанию (сбросить)».
 */
export function dubChoices(rec: SeriesTracks | null): DubChoice[] {
  const k = (rec && rec.k) || [];
  const out: DubChoice[] = k.map((s, i) => ({ label: seenLabel(s.l, s.g, s.c), value: 'k' + i }));
  const v = dubValue(rec);
  if (rec && v === 'l') out.unshift({ label: seenLabel(rec.l || '', rec.g, rec.c), value: 'l' });
  if (rec && v.indexOf('g:') === 0) out.unshift({ label: langName(rec.g || ''), value: v });
  return out.concat([{ label: t('series.dubReset'), value: DUB_RESET }]);
}

/** The journal patch of a choice; null for an unknown value. */
export function dubPatch(rec: SeriesTracks | null, value: string): SeriesTracksPatch | null {
  if (value === DUB_RESET) return 'reset';
  if (value === 'l') return rec && rec.l ? (rec.c ? { l: rec.l, g: rec.g || '', c: rec.c } : { l: rec.l, g: rec.g || '' }) : null;
  if (value.indexOf('g:') === 0) return value.length > 2 ? { l: '', g: value.slice(2) } : null;
  const k = (rec && rec.k) || [];
  const s = value.charAt(0) === 'k' ? k[+value.slice(1)] : undefined;
  return s ? (s.c ? { l: s.l, g: s.g, c: s.c } : { l: s.l, g: s.g }) : null;
}

/** The torrent a series choice is written to: the one holding the newest record, else the first of the series. */
export function dubTarget(members: Torrent[]): Torrent | null {
  const rec = newestSeriesTracks(members);
  if (rec) {
    for (let i = 0; i < members.length; i++) {
      const r = seriesTracksOf(members[i].data);
      if (r && r.at === rec.at) return members[i];
    }
  }
  return members[0] || null;
}

export interface SeriesDub {
  rec: SeriesTracks | null;
  text: string;
  value: string;
  choices: DubChoice[];
  /** Writes a choice; rejects with the error to show. */
  pick(value: string): Promise<void>;
}

/** The «Озвучка» row of a series: the newest record among its torrents, a choice shown at once. */
export function useSeriesDub(members: Torrent[], c: JournalClient | null): SeriesDub {
  const [local, setLocal] = useState<SeriesTracks | null>(null);
  const stored = newestSeriesTracks(members);
  const rec = local && (!stored || local.at >= stored.at) ? local : stored;
  const pick = (value: string): Promise<void> => {
    const patch = dubPatch(rec, value);
    const target = dubTarget(members);
    if (!patch || !target || !c) return Promise.resolve();
    return saveSeriesTracks(c, target.hash, members.map((m) => m.hash), patch).then((saved) => {
      setLocal(saved);
    });
  };
  return { rec, text: dubText(rec), value: dubValue(rec), choices: dubChoices(rec), pick };
}
