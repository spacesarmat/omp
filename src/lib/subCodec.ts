/** How an embedded subtitle codec is drawn. Image codecs other than PGS stay labeled, not silent. */

export type SubtitleKind = 'text' | 'pgs' | 'image' | 'other';

export function subtitleKind(codec: string): SubtitleKind {
  const c = (codec || '').toLowerCase().replace(/-/g, '_');
  if (c === 'subrip' || c === 'srt' || c === 'ass' || c === 'ssa' || c === 'text' || c === 'mov_text' || c === 'tx3g' || c === 'webvtt' || c === 'vtt') return 'text';
  if (c === 'hdmv_pgs_subtitle' || c === 'pgssub' || c === 'pgs') return 'pgs';
  if (c === 'dvd_subtitle' || c === 'dvdsub' || c === 'vobsub' || c === 'dvb_subtitle' || c === 'dvb_sub' || c === 'dvbsub') return 'image';
  return 'other';
}
