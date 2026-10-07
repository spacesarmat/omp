import { t, t as tr } from '../i18n';
import type { CacheState, FfprobeResult } from '../api/types';
import { cueAt, Cue } from '../lib/subtitles';
import { formatSpeed } from '../lib/format';
import { settings } from '../store/settings';
import { videoSummary, type InfoPanel } from './infoPanel';
import { tvGlyphs } from '../ui/tvText';
import { Spinner, ErrorView } from '../ui/components';

/**
 * «Инфо» (Yellow / Info), the panel of the Android TV player: header (episode; HDR mark · codec · size), three tiles,
 * the sound, the buffer bar. Every text is one line (cut with an ellipsis).
 */
export function InfoOverlay(p: { panel: InfoPanel }) {
  const d = p.panel;
  return (
    <div class="player-info">
      <div class="pi-head">
        <span class="pi-title">{tvGlyphs(d.title)}</span>
        {(d.hdr || d.chip) && (
          <span class="pi-chip">
            {d.hdr && <b class="pi-hdr">{d.hdr}</b>}
            {d.hdr && d.chip ? ' · ' : ''}
            {d.chip}
          </span>
        )}
      </div>
      <div class="pi-tiles">
        {d.tiles.map((x) => (
          <div class="pi-tile" key={x.label}>
            <div class="pi-label">{x.label}</div>
            <div class="pi-value">
              {x.value}
              {x.unit && <span class="pi-unit"> {x.unit}</span>}
            </div>
          </div>
        ))}
      </div>
      <div class="pi-line">
        <span class="pi-label-inline">{t('player.info.sound')}</span>
        {d.sound}
      </div>
      <div class="pi-line pi-buffer">
        <span class="pi-label-inline">{t('player.info.buffer')}</span>
        <span class="pi-bar"><span class="pi-bar-fill" style={{ width: Math.round(d.bufferFill * 100) + '%' }} /></span>
        <span class="pi-num">{d.buffer}</span>
      </div>
    </div>
  );
}

export function BufferingOverlay(p: { cache: CacheState | null }) {
  const t = p.cache && p.cache.Torrent;
  const text = tr('player.buffering') + (t ? ' ' + formatSpeed(t.download_speed || 0) + tr('player.bufferPeers', { n: t.active_peers || 0 }) : '');
  return (
    <div class="player-buffer">
      <Spinner text={text} />
    </div>
  );
}

export function SubtitleOverlay(p: { cues: Cue[] | null; time: number; raised: boolean; offset: number }) {
  const s = settings.value;
  if (!p.cues) return null;
  const text = cueAt(p.cues, p.time - p.offset);
  if (!text) return null;
  const cls = 'subtitles sub-' + s.subSize + ' sub-' + s.subColor + (s.subBackground ? ' sub-bg' : ' sub-nobg') + (p.raised ? ' raised' : '');
  return (
    <div class={cls}>
      <span>{text}</span>
    </div>
  );
}

export function NextBanner(p: { seconds: number; title: string; onNext: () => void }) {
  return (
    <div class="next-banner" onClick={(e) => { e.stopPropagation(); p.onNext(); }}>
      <div>{t('player.nextIn', { n: p.seconds })}</div>
      <div class="meta">{p.title}</div>
      <div class="meta">{t('player.nextKeys')}</div>
    </div>
  );
}

/** `lift`: above the «Поддержать» card shown on pause in the same corner. */
export function SkipBanner(p: { onSkip: () => void; lift?: boolean }) {
  return (
    <div class={'next-banner' + (p.lift ? ' over-donate' : '')} onClick={(e) => { e.stopPropagation(); p.onSkip(); }}>
      <div>{t('player.skipIntro')}</div>
      <div class="meta">{t('player.skipKeys')}</div>
    </div>
  );
}

export function UndoBanner(p: { text: string; onUndo: () => void; lift?: boolean }) {
  return (
    <div class={'next-banner' + (p.lift ? ' over-donate' : '')} onClick={(e) => { e.stopPropagation(); p.onUndo(); }}>
      <div>{p.text}{t('player.undoSuffix')}</div>
      <div class="meta">{t('player.undoKeys')}</div>
    </div>
  );
}

export function PlayerError(p: { message: string; probe: FfprobeResult | null; onRetry: () => void; onBack: () => void }) {
  const details = videoSummary(p.probe);
  return (
    <div class="player-error" onClick={(e) => e.stopPropagation()}>
      <ErrorView
        message={p.message + (details ? '\n\n' + details : '')}
        actions={[
          { label: t('common.retry'), onPress: p.onRetry },
          { label: t('player.back'), onPress: p.onBack },
        ]}
      />
    </div>
  );
}
