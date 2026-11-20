import { useEffect, useRef } from 'preact/hooks';
import { t, t as tr } from '../i18n';
import type { PgsBitmap } from '../lib/pgs';
import type { CacheState, FfprobeResult } from '../api/types';
import { cueAt, Cue } from '../lib/subtitles';
import { formatSpeed } from '../lib/format';
import { settings } from '../store/settings';
import { videoSummary, type InfoPanel } from './infoPanel';
import { tvGlyphs } from '../ui/tvText';
import { Spinner, ErrorView } from '../ui/components';

/** Peers and speed while the first bytes are still on the way; the short «Буферизация…» line once playback has started. */
export function bufferStatusText(waiting: boolean, tor: { download_speed?: number; active_peers?: number } | null): string {
  if (waiting) return tr('player.connecting', { n: tor ? tor.active_peers || 0 : 0, speed: formatSpeed(tor ? tor.download_speed || 0 : 0) });
  if (!tor) return tr('player.buffering');
  return tr('player.buffering') + ' ' + formatSpeed(tor.download_speed || 0) + tr('player.bufferPeers', { n: tor.active_peers || 0 });
}

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

export function BufferingOverlay(p: { cache: CacheState | null; waiting?: boolean }) {
  const tor = p.cache && p.cache.Torrent ? p.cache.Torrent : null;
  return (
    <div class="player-buffer">
      <Spinner text={bufferStatusText(!!p.waiting, tor)} />
    </div>
  );
}

/** One PGS bitmap in the video's own pixel grid, stretched with the picture. */
export function BitmapSubtitle(p: { frame: PgsBitmap | null; raised: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = settings.value.subSize;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { return; }
    if (!ctx) return;
    const frame = p.frame;
    const vw = frame && frame.videoW > 0 ? frame.videoW : 1920;
    const vh = frame && frame.videoH > 0 ? frame.videoH : 1080;
    if (canvas.width !== vw) canvas.width = vw;
    if (canvas.height !== vh) canvas.height = vh;
    ctx.clearRect(0, 0, vw, vh);
    if (!frame || !frame.rgba.length || !frame.w || !frame.h) return;
    const scale = size === 'small' ? 0.85 : size === 'large' ? 1.2 : 1;
    const tmp = document.createElement('canvas');
    tmp.width = frame.w;
    tmp.height = frame.h;
    let tctx: CanvasRenderingContext2D | null = null;
    try { tctx = tmp.getContext('2d'); } catch (e) { return; }
    if (!tctx) return;
    const img = tctx.createImageData(frame.w, frame.h);
    img.data.set(frame.rgba);
    tctx.putImageData(img, 0, 0);
    const w = Math.max(1, Math.round(frame.w * scale));
    const h = Math.max(1, Math.round(frame.h * scale));
    const x = frame.x - Math.round((w - frame.w) / 2);
    const y = frame.y - Math.round((h - frame.h) / 2);
    ctx.drawImage(tmp, x, y, w, h);
  }, [p.frame, size]);
  return <canvas ref={ref} class={'sub-bitmap' + (p.raised ? ' raised' : '')} />;
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

export function PlayerError(p: {
  message: string;
  probe: FfprobeResult | null;
  /** Codec failures only: the container line under the message. */
  showProbe?: boolean;
  onRetry: () => void;
  onBack: () => void;
  /** «Другая раздача». When set, it is the primary button and takes D-pad focus. */
  onAnother?: () => void;
  /** Primary label when it is not «Другая раздача» (the dead-release «Найти в лучшем качестве»). */
  anotherLabel?: string;
  /** «Ниже качество»: another release with a lower picture. */
  onLower?: () => void;
}) {
  const details = p.showProbe ? videoSummary(p.probe) : '';
  const another = !!p.onAnother;
  const actions = [];
  if (p.onAnother) actions.push({ label: p.anotherLabel || t('player.anotherRelease'), onPress: p.onAnother, focusKey: 'player-err-another', className: 'primary' });
  if (p.onLower) actions.push({ label: t('viewer.lowerQuality'), onPress: p.onLower, focusKey: 'player-err-lower' });
  actions.push({ label: t('common.retry'), onPress: p.onRetry, focusKey: 'player-err-retry', className: another ? '' : 'primary' });
  actions.push({ label: t('player.back'), onPress: p.onBack, focusKey: 'player-err-back' });
  return (
    <div class="player-error" onClick={(e) => e.stopPropagation()}>
      <ErrorView
        message={p.message}
        detail={details || undefined}
        actions={actions}
        preferredChildFocusKey={another ? 'player-err-another' : 'player-err-retry'}
      />
    </div>
  );
}
