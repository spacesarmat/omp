import { t as tt } from '../i18n';
import type { CacheState, FfprobeResult, FfprobeStream } from '../api/types';
import { formatBytes, formatSpeed } from '../lib/format';

export function hdrLabel(s: FfprobeStream): string {
  if (/dvh1|dvhe/i.test(s.codec_tag_string || '')) return 'Dolby Vision';
  if (s.color_transfer === 'smpte2084') return 'HDR10';
  if (s.color_transfer === 'arib-std-b67') return 'HLG';
  return '';
}

export function statsLines(cache: CacheState | null, probe: FfprobeResult | null): string[] {
  const out: string[] = [];
  const t = cache && cache.Torrent;
  if (t) {
    out.push(tt('player.statSpeed', { v: formatSpeed(t.download_speed || 0) }));
    out.push(tt('player.statPeers', { active: t.active_peers || 0, total: t.total_peers || 0, seeds: t.connected_seeders || 0 }));
  }
  if (cache && cache.Capacity > 0) {
    out.push(tt('player.statCache', { filled: formatBytes(cache.Filled), cap: formatBytes(cache.Capacity), pct: Math.min(100, Math.round((cache.Filled * 100) / cache.Capacity)) }));
  }
  const v = probe ? probe.streams.find((s) => s.codec_type === 'video') : undefined;
  if (v) {
    const parts = [tt('player.statVideo', { codec: v.codec_name.toUpperCase() })];
    if (v.profile) parts.push(v.profile);
    if (v.width && v.height) parts.push(v.width + '×' + v.height);
    const hdr = hdrLabel(v);
    if (hdr) parts.push(hdr);
    out.push(parts.join(' '));
  }
  const br = probe && probe.format && probe.format.bit_rate;
  if (br) out.push(tt('player.statBitrate', { n: (+br / 1e6).toFixed(1) }));
  return out;
}
