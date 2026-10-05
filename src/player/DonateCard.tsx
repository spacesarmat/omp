// «Поддержать» card of the TV player: a QR code of the donation link while playback is paused (bottom right, above
// the progress bar) and during the end credits (bottom left, next to «Следующая серия»). Purely visual: it takes no
// focus and no keys or clicks. Hidden for a supporter (support code applied on a phone, omp.d.until in the journal)
// and when no donation method opens the QR code's link.
import { t } from '../i18n';
import { DONATE_QR } from '../ui/donateQr';
import { DONATE_QR_LABEL, qrMethodActive } from '../lib/donate';

export type DonateMode = 'pause' | 'credits' | null;

export interface DonateModeInput {
  /** Not a supporter and a method opens the QR link (donateCardEnabled). */
  enabled: boolean;
  /** The item plays or played (not loading, no error view). */
  started: boolean;
  error: boolean;
  paused: boolean;
  time: number;
  duration: number;
  /** Credits start of the item (chapter or manual mark), null when unknown. */
  creditsStart: number | null;
  /** «Следующая серия через N» is on screen. */
  countdown: boolean;
}

/**
 * Where the card is: on pause; in the credits when they are known (chapter «Титры» / the manual mark) or the
 * «Следующая серия» countdown runs. Without known credits there is no card at the end of a movie (no reliable signal).
 */
export function donateMode(o: DonateModeInput): DonateMode {
  if (!o.enabled || !o.started || o.error) return null;
  if (o.paused) return 'pause';
  if (o.countdown) return 'credits';
  const cs = o.creditsStart;
  if (cs !== null && cs > 0 && o.duration > 0 && cs < o.duration && o.time >= cs && o.time < o.duration) return 'credits';
  return null;
}

/** The card may show at all: no active support mark and the QR link is a configured method. */
export function donateCardEnabled(supporter: boolean, qrUrl: string = DONATE_QR.url): boolean {
  return !supporter && !!DONATE_QR.path && qrMethodActive(qrUrl);
}

const CRISP: any = { 'shape-rendering': 'crispEdges' };

/** The QR code: white square with the quiet zone, dark modules as one path. */
export function DonateQrSvg(p: { px: number }) {
  const n = DONATE_QR.size;
  return (
    <svg class="donate-qr" width={p.px} height={p.px} viewBox={'0 0 ' + n + ' ' + n} aria-label={t('player.donateQrLabel')} role="img" {...CRISP}>
      <rect width={n} height={n} fill="#fff"></rect>
      <path d={DONATE_QR.path} fill="#0f1115"></path>
    </svg>
  );
}

export function DonateCard(p: { mode: DonateMode; raised?: boolean }) {
  if (!p.mode) return null;
  const pause = p.mode === 'pause';
  return (
    <div class={'donate-card donate-' + p.mode + (p.raised ? ' raised' : '')}>
      <DonateQrSvg px={198} />
      <div class="donate-text">
        <div class="donate-title">{pause ? t('player.donateLikeTitle') : t('player.donateThanksTitle')}</div>
        <div class="donate-body">{pause ? t('player.donateLikeBody') : t('player.donateThanksBody')}</div>
        <div class="donate-link">{DONATE_QR_LABEL}</div>
      </div>
    </div>
  );
}
