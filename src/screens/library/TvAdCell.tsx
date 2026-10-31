// A catalog ad on the TV: the same size as the cards around it, with «Реклама», the advertiser and the erid.
// qr mode: OK opens a large QR of the link (a TV has no useful click). noclick: the cell is not focusable.
// The cell itself is the grid child (no wrapper), so the row's nth-child margins stay aligned.
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { t } from '../../i18n';
import type { AdBanner } from '../../ads/ads';
import { Focusable, Button, FocusGroup } from '../../ui/components';
import { Qr } from '../../ui/Qr';
import { useKeys } from '../../ui/keys';

export type TvAdKind = 'large' | 'small' | 'list' | 'compact' | 'disc';

const SHOWN_MS = 1000;

const qrBanner = signal<AdBanner | null>(null);

export function openAdQr(b: AdBanner): void {
  qrBanner.value = b;
}

export function closeAdQr(): void {
  qrBanner.value = null;
}

/** Mounted once next to the other dialogs. */
export function AdQrHost() {
  const b = qrBanner.value;
  useKeys((a) => {
    if (!qrBanner.value) return false;
    if (a === 'back' || a === 'enter') {
      qrBanner.value = null;
      return true;
    }
    return true;
  }, 20);
  if (!b) return null;
  const close = () => {
    qrBanner.value = null;
  };
  return (
    <div class="dialog-backdrop ad-qr-back">
      <FocusGroup focusKey="AD-QR" className="dialog ad-qr-card" boundary autoFocus preferredChildFocusKey="ad-qr-close">
        <Qr text={b.url} size={280} />
        <div class="ad-qr-copy">
          <div class="ad-label">{t('ads.label')}</div>
          <div class="ad-qr-title">{b.title}</div>
          {b.text ? <div class="ad-qr-text">{b.text}</div> : null}
          <div class="ad-who">{b.advertiser}</div>
          <div class="ad-erid">{t('ads.erid', { erid: b.erid })}</div>
          <div class="ad-qr-hint">{t('ads.qrHint')}</div>
          <div class="ad-qr-actions">
            <Button focusKey="ad-qr-close" label={t('ads.qrClose')} onPress={close} />
          </div>
        </div>
      </FocusGroup>
    </div>
  );
}

function useShown(onShown: () => void, bannerId: string) {
  const cb = useRef(onShown);
  cb.current = onShown;
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!node || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5);
        if (visible && timer === undefined) {
          timer = setTimeout(() => {
            timer = undefined;
            cb.current();
          }, SHOWN_MS);
        } else if (!visible && timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [node, bannerId]);
  return setNode;
}

function Mark(p: { b: AdBanner }) {
  return (
    <div class="ad-mark">
      <div class="ad-label">{t('ads.label')}</div>
      <div class="ad-who">{p.b.advertiser}</div>
      <div class="ad-erid">{t('ads.erid', { erid: p.b.erid })}</div>
    </div>
  );
}

function Poster(p: { b: AdBanner; disc?: boolean }) {
  return (
    <div class={p.disc ? 'disc-poster' : 'art'}>
      <img src={p.b.image} alt="" />
      <span class="ad-badge">{t('ads.label')}</span>
    </div>
  );
}

export function TvAdCell(p: { kind: TvAdKind; banner: AdBanner; focusKey: string; onShown: () => void; onClick: () => void }) {
  const b = p.banner;
  const qr = b.tvMode !== 'noclick';
  const setEl = useShown(p.onShown, b.id);
  const aria = t('ads.aria', { title: b.title, advertiser: b.advertiser });
  const press = () => {
    p.onClick();
    openAdQr(b);
  };
  let cls = '';
  let inner: ComponentChildren;
  if (p.kind === 'list') {
    cls = 'lrow ad-row';
    inner = (
      <div class="ad-fill" ref={setEl}>
        <div class="art ad-art"><img src={b.image} alt="" /><span class="ad-badge">{t('ads.label')}</span></div>
        <div class="lrow-main">
          <div class="lrow-title">{b.title}</div>
          <Mark b={b} />
        </div>
      </div>
    );
  } else if (p.kind === 'compact') {
    cls = 'crow ad-crow';
    inner = (
      <div class="ad-line" ref={setEl}>
        <span class="ad-label">{t('ads.label')}</span>
        <span class="crow-title">{b.title}</span>
        <span class="ad-who">{b.advertiser}</span>
        <span class="ad-erid">{t('ads.erid', { erid: b.erid })}</span>
      </div>
    );
  } else if (p.kind === 'disc') {
    cls = 'disc-tile ad-tile';
    inner = (
      <div ref={setEl}>
        <Poster b={b} disc />
        <div class="disc-title">{b.title}</div>
        <Mark b={b} />
      </div>
    );
  } else {
    cls = 'tile ad-tile tile-' + p.kind;
    inner = (
      <div ref={setEl}>
        <Poster b={b} />
        <div class="tile-title">{b.title}</div>
        <Mark b={b} />
      </div>
    );
  }
  if (!qr) {
    return (
      <div class={cls} data-ad={b.id} aria-label={aria}>
        {inner}
      </div>
    );
  }
  return (
    <Focusable focusKey={p.focusKey} className={cls} ariaLabel={aria} onPress={press}>
      {inner}
    </Focusable>
  );
}
