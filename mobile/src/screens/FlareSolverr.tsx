import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { Icon } from '../ui/Icon';
import { goBack, navigate } from '../nav';
import { phoneSourceContext } from '../searchContext';
import { native } from '../platform/native';
import { FLARESOLVERR_Q } from '../../../src/faq/faq';
import { flareSolverrUrl, normalizeFlareUrl, setFlareSolverrUrl } from '../../../src/sources/flareStore';
import {
  flareBadAddress,
  checkFlareSolverr,
  checkText,
  flareHowto,
  flareIntro,
  flareNoneText,
  flareNoneTitle,
  flareHost,
  flareStatus,
  flareNoWifi,
  flareNotFound,
  refreshFlareStatus,
  scanFlareSolverr,
  setFlareStatus,
  type FlareCheck,
} from '../../../src/sources/flaresolverr';
import type { LanScan } from '../../../src/sources/indexerDiscovery';
import type { SourceContext } from '../../../src/sources/types';
import { log } from '../../../src/lib/log';

export const addressRemoved = () => t('sources.flare.addressRemoved');

function phoneScan(): LanScan {
  return (ports) => native.scanLan(ports);
}

/**
 * «Источники поиска» → FlareSolverr (mockup «FlareSolverr»): address, «Найти в сети» (port 8191 on the home network),
 * «Проверить» (saves the address and shows «Работает · версия · ответ»), how to install it. ctx / scan: fakes in tests.
 */
export function FlareSolverr({ ctx = phoneSourceContext, scan = phoneScan }: { ctx?: () => SourceContext; scan?: () => LanScan } = {}) {
  const saved = flareSolverrUrl();
  const [value, setValue] = useState(saved || '');
  const [check, setCheck] = useState<FlareCheck | null>(() => {
    const st = flareStatus();
    return st && st.url === saved ? st.check : null;
  });
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (saved && !check) {
      setBusy(true);
      refreshFlareStatus(ctx().http).then((s) => {
        if (!alive.current) return;
        setBusy(false);
        if (s) setCheck(s.check);
      });
    }
    return () => {
      alive.current = false;
    };
  }, []);

  const runCheck = (raw: string) => {
    if (busy) return;
    setNote('');
    setFound([]);
    if (!raw.trim()) {
      setFlareSolverrUrl(null);
      setFlareStatus(null);
      setCheck(null);
      setNote(addressRemoved());
      return;
    }
    const url = normalizeFlareUrl(raw);
    if (!url) {
      setCheck({ ok: false, message: flareBadAddress() });
      return;
    }
    setValue(url);
    // the address the user typed is kept even when FlareSolverr is off right now
    setFlareSolverrUrl(url);
    setBusy(true);
    setCheck(null);
    checkFlareSolverr(url, ctx().http).then((c) => {
      setFlareStatus({ url, check: c, at: Date.now() });
      log(c.ok ? 'info' : 'warn', 'search', c.ok ? t('sources.flare.logWorks') : t('sources.flare.logFailed', { message: c.message }));
      if (!alive.current) return;
      setBusy(false);
      setCheck(c);
    });
  };

  const find = () => {
    if (scanning || busy) return;
    setScanning(true);
    setNote('');
    setFound([]);
    scanFlareSolverr(scan(), ctx().http).then((list) => {
      if (!alive.current) return;
      setScanning(false);
      if (list === null) return setNote(flareNoWifi());
      if (!list.length) return setNote(flareNotFound());
      if (list.length === 1) return runCheck(list[0]);
      setFound(list);
    });
  };

  return (
    <div class="m-screen" data-route="flaresolverr">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">FlareSolverr</h1>
      </div>
      <div class="m-flare">
        <div class="m-flare-intro">{flareIntro()}</div>
        <div class="m-field">
          <label for="flare-url">{t('connect.addressShort')}</label>
          <input
            id="flare-url"
            class="m-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="http://192.168.1.10:8191"
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="m-flare-actions">
          <button type="button" class="m-btn m-btn-secondary" disabled={scanning || busy} onClick={find}>
            {scanning ? t('connect.searchingShort') : t('connect.scan')}
          </button>
          <button type="button" class="m-btn m-btn-primary" disabled={busy || scanning} onClick={() => runCheck(value)}>
            {busy ? t('sources.flare.tvChecking') : t('common.check')}
          </button>
        </div>
        {found.length > 1 && (
          <div class="m-set-card" data-found="flare">
            <div class="m-note m-muted">{t('sources.flare.foundSeveral')}</div>
            {found.map((u) => (
              <button type="button" key={u} class="m-btn m-btn-secondary m-btn-sm" onClick={() => runCheck(u)}>
                {flareHost(u)}
              </button>
            ))}
          </div>
        )}
        {check && check.ok && (
          <div class="m-idx-done" data-flare-state="ok">
            {checkText(check)}
          </div>
        )}
        {check && !check.ok && (
          <div class="m-error" role="alert" data-flare-state="error">
            {checkText(check)}
          </div>
        )}
        {note && <div class="m-note m-muted">{note}</div>}
        <div class="m-set-card m-flare-howto">
          <div class="m-flare-howto-title">{flareNoneTitle()}</div>
          <div class="m-note m-muted">{flareNoneText()}</div>
          <button type="button" class="m-link" onClick={() => navigate({ name: 'faq', q: FLARESOLVERR_Q })}>
            {flareHowto()}
          </button>
        </div>
      </div>
    </div>
  );
}
