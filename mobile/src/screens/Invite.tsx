import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { t } from '../../../src/i18n';
import { inviteView } from '../../../src/lib/referral';
import { goBack } from '../nav';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';

const BACK = 'M15 5l-7 7 7 7';

/** The program is off until an admin turns it on. The screen still explains that. */
export function Invite({ enabled = false, code = '', friends = 0 }: { enabled?: boolean; code?: string; friends?: number }) {
  const view = inviteView({ enabled, code, friends });
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!view.link) {
      setQr('');
      return;
    }
    let alive = true;
    void QRCode.toDataURL(view.link, { margin: 1, width: 180 }).then(
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
    const clip = navigator.clipboard;
    if (clip && clip.writeText) void clip.writeText(text).then(() => showToast(t('invite.copied')), () => undefined);
  };
  return (
    <div class="m-screen" data-route="invite">
      <div class="m-bar">
        <button type="button" class="m-icon-btn tm" data-code="P36.1" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title">{t('invite.title')}</h1>
      </div>
      {!view.enabled ? (
        <p class="m-muted">{t('invite.off')}</p>
      ) : (
        <>
          <p data-invite-link>{view.link}</p>
          <p data-invite-code>{t('invite.code', { code: view.code })}</p>
          <p data-invite-count>{t('invite.friends', { n: view.friends })}</p>
          {qr ? <img src={qr} alt={t('invite.qr')} width={180} height={180} /> : null}
          <button type="button" class="m-btn m-btn-primary tm" data-code="P36.2" data-invite-share onClick={share}>
            {t('invite.share')}
          </button>
        </>
      )}
    </div>
  );
}
