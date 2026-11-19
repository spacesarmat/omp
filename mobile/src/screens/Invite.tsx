import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { t } from '../../../src/i18n';
import { inviteView } from '../../../src/lib/referral';
import { goBack } from '../nav';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';

const BACK = 'M15 5l-7 7 7 7';
const COPY = 'M8 8h11v11H8zM5 16V5h11';

export interface InviteCard {
  enabled: boolean;
  code: string;
  friends: number;
  noticeDays?: number;
  noticeCredit?: number;
}

function copyText(text: string, ok: string) {
  const clip = navigator.clipboard;
  if (!text || !clip || !clip.writeText) return;
  void clip.writeText(text).then(() => showToast(ok), () => undefined);
}

/** The program is off until an admin turns it on. A loader reads the signed-in card from /v1/me. */
export function Invite({
  enabled = false,
  code = '',
  friends = 0,
  load,
}: {
  enabled?: boolean;
  code?: string;
  friends?: number;
  load?: () => Promise<InviteCard>;
}) {
  const [card, setCard] = useState<InviteCard>(load ? { enabled: false, code: '', friends: 0 } : { enabled, code, friends });
  useEffect(() => {
    if (!load) return;
    let alive = true;
    void load().then(
      (row) => {
        if (alive && row) setCard(row);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [load]);
  const view = inviteView(card);
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!view.link) {
      setQr('');
      return;
    }
    let alive = true;
    void QRCode.toDataURL(view.link, { margin: 1, width: 180, color: { dark: '#0F1115', light: '#FFFFFF' } }).then(
      (url: string) => {
        if (alive) setQr(url);
      },
      () => {
        if (alive) setQr('');
      },
    );
    return () => {
      alive = false;
    };
  }, [view.link]);
  const share = () => {
    const text = view.link;
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav.share) {
      void nav.share({ text }).catch(() => undefined);
      return;
    }
    copyText(text, t('invite.copied'));
  };
  return (
    <div class="m-screen m-invite" data-route="invite">
      <div class="m-bar">
        <button type="button" class="m-icon-btn tm" data-code="P36.1" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title">{t('invite.title')}</h1>
      </div>
      {!view.enabled ? (
        <p class="m-muted m-invite-off">{t('invite.off')}</p>
      ) : (
        <div class="m-invite-body">
          <h2 class="m-invite-title">{t('invite.headline')}</h2>
          <p class="m-invite-lead">{t('invite.lead')}</p>
          {card.noticeDays ? <p class="m-invite-notice" data-invite-notice>{t('invite.noticeApp', { n: card.noticeDays })}</p> : null}
          {card.noticeCredit ? <p class="m-invite-notice" data-invite-credit>{t('invite.noticeCredit', { n: card.noticeCredit })}</p> : null}
          <div class="m-invite-qr">
            {qr ? <img src={qr} alt={t('invite.qr')} width={148} height={148} /> : <div class="m-invite-qr-ph" />}
          </div>
          <button type="button" class="m-invite-chip" aria-label={t('invite.copyCode')} onClick={() => copyText(view.code, t('invite.codeCopied'))}>
            <span data-invite-code>{view.code}</span>
            <Icon d={COPY} size={16} />
          </button>
          <button type="button" class="m-invite-row" aria-label={t('invite.copyLink')} onClick={() => copyText(view.link, t('invite.copied'))}>
            <span data-invite-link>{view.link}</span>
            <Icon d={COPY} size={16} />
          </button>
          <div class="m-invite-stat">
            <span>{t('invite.friendsLabel')}</span>
            <b data-invite-count>{view.friends}</b>
          </div>
          <button type="button" class="m-btn m-btn-primary m-invite-share tm" data-code="P36.2" data-invite-share onClick={share}>
            {t('invite.share')}
          </button>
        </div>
      )}
    </div>
  );
}
