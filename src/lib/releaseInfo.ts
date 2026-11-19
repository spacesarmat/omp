import { parseEpisodeRange } from '../monitor/episodes';

export interface ReleaseInfo {
  year?: number;
  resolution?: string;
  hdr?: string;
  /** Dolby Vision, kept apart from HDR so both can show. */
  dv?: boolean;
  codec?: string;
  source?: string;
}

// token boundaries without lookbehind (Chromium 53)
const B = '(?:^|[^a-z0-9])';
const E = '(?:[^a-z0-9]|$)';
const re = (body: string) => new RegExp(B + '(?:' + body + ')' + E, 'i');

const RES = new RegExp(B + '(2160|1080|720|480)[pi]' + E, 'i');
const K4 = re('4k|uhd');
const FHDR = re('fhdr');
const FHD = re('fhd|full[ .]?hd');
const SD = re('sd');
const HD = re('hd');
const YEAR = /(?:^|[^0-9])(19[5-9][0-9]|20[0-4][0-9])(?:[^0-9]|$)/;
const DV = re('dolby[ .]?vision|dv|dovi');
const HDR10P = /(?:^|[^a-z0-9])hdr10(?:\+|plus)/i;
const HDR = re('hdr|hdr10');
const HEVC = re('x265|h\\.?265|hevc');
const AVC = re('x264|h\\.?264|avc');
const AV1 = re('av1');
const REMUX = /remux/i;
const BLURAY = re('bdrip|blu-?ray|bluray');
const WEBRIP = re('web-?dl-?rip|webrip');
const WEBDL = re('web-?dl');
const HDTV = re('hdtv');

export function parseReleaseInfo(title: string): ReleaseInfo {
  const t = title || '';
  const info: ReleaseInfo = {};
  const r = RES.exec(t);
  if (r) info.resolution = r[1] + 'p';
  else if (K4.test(t)) info.resolution = '2160p';
  else if (FHDR.test(t) || FHD.test(t)) info.resolution = '1080p';
  else if (SD.test(t)) info.resolution = '480p';
  else if (HD.test(t)) info.resolution = '720p';
  if (HDR10P.test(t)) info.hdr = 'HDR10+';
  else if (FHDR.test(t) || HDR.test(t)) info.hdr = 'HDR';
  if (DV.test(t)) info.dv = true;
  if (HEVC.test(t)) info.codec = 'HEVC';
  else if (AV1.test(t)) info.codec = 'AV1';
  else if (AVC.test(t)) info.codec = 'AVC';
  if (REMUX.test(t)) info.source = 'Remux';
  else if (BLURAY.test(t)) info.source = 'BluRay';
  else if (WEBRIP.test(t)) info.source = 'WEBRip';
  else if (WEBDL.test(t)) info.source = 'WEB-DL';
  else if (HDTV.test(t)) info.source = 'HDTV';
  const y = YEAR.exec(t);
  if (y) info.year = +y[1];
  return info;
}

export function releaseBadges(info: ReleaseInfo): string[] {
  const out: string[] = [];
  if (info.resolution) out.push(info.resolution);
  if (info.hdr) out.push(info.hdr);
  if (info.dv) out.push('DV');
  if (info.codec) out.push(info.codec);
  if (info.source) out.push(info.source);
  if (info.year) out.push(String(info.year));
  return out;
}

export function displayBadge(b: string): string {
  if (b === '2160p') return '4K';
  if (b === '480p') return 'SD';
  return b;
}

/** A provider quality string ("1080p", "FHD", "4K") as 2160p/1080p/720p/480p, or ''. */
export function resolutionToken(raw: string | undefined): string {
  const named = parseReleaseInfo(raw || '').resolution;
  if (named) return named;
  const bare = /^\s*(2160|1080|720|480)\s*$/.exec(raw || '');
  return bare ? bare[1] + 'p' : '';
}

/**
 * Resolution from the size when the title does not name one.
 * A known episode span uses size per episode. One named season uses the pack size.
 */
export function resolutionFromSize(title: string, sizeBytes: number | undefined): string {
  if (!sizeBytes || sizeBytes <= 0) return '';
  const gb = sizeBytes / 1e9;
  const range = parseEpisodeRange(title || '');
  const eps = range.from !== undefined && range.to !== undefined && range.to >= range.from ? range.to - range.from + 1 : 0;
  if (eps > 0) {
    const per = gb / eps;
    if (per >= 4) return '2160p';
    if (per >= 1.2) return '1080p';
    if (per >= 0.35) return '720p';
    if (per >= 0.08) return '480p';
    return '';
  }
  if (range.season === undefined || range.seasonTo !== undefined) return '';
  if (gb >= 40) return '2160p';
  if (gb >= 8) return '1080p';
  if (gb >= 2.5) return '720p';
  if (gb >= 0.5) return '480p';
  return '';
}
