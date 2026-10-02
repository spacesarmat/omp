export interface ReleaseInfo {
  year?: number;
  resolution?: string;
  hdr?: string;
  codec?: string;
  source?: string;
}

// token boundaries without lookbehind (Chromium 53)
const B = '(?:^|[^a-z0-9])';
const E = '(?:[^a-z0-9]|$)';
const re = (body: string) => new RegExp(B + '(?:' + body + ')' + E, 'i');

const RES = new RegExp(B + '(2160|1080|720|480)[pi]' + E, 'i');
const K4 = re('4k|uhd');
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
  if (DV.test(t)) info.hdr = 'DV';
  else if (HDR10P.test(t)) info.hdr = 'HDR10+';
  else if (HDR.test(t)) info.hdr = 'HDR';
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
  if (info.codec) out.push(info.codec);
  if (info.source) out.push(info.source);
  if (info.year) out.push(String(info.year));
  return out;
}

export function displayBadge(b: string): string {
  return b === '2160p' ? '4K' : b;
}
