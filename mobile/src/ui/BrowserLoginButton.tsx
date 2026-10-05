import { useEffect, useRef, useState } from 'preact/hooks';
import { showToast } from './toast';
import { log } from '../../../src/lib/log';
import { BROWSER_BUSY, BROWSER_FAILED, BROWSER_LOGIN, BROWSER_STORE_FAILED, browserSignedIn, hasBrowserLogin } from '../../../src/sources/browserLogin';
import type { Source, SourceContext } from '../../../src/sources/types';

/**
 * «Войти через браузер» under a login form (every site with a browser login): the native sheet with the site's login
 * page; the person signs in there themselves, the session is kept natively. With `suggest` (the form login hit a
 * captcha or a Cloudflare check, browserSuggestion) that text comes first and the button is the primary one.
 */
export function BrowserLoginButton({
  source,
  ctx,
  suggest,
  disabled,
  onDone,
}: {
  source: Source;
  ctx: () => SourceContext;
  suggest?: string;
  disabled?: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  if (!source.browserLogin || !hasBrowserLogin()) return null;

  const open = () => {
    if (busy || !source.browserLogin) return;
    setBusy(true);
    source.browserLogin(ctx()).then(
      (r) => {
        if (alive.current) setBusy(false);
        if (r.result === 'ok') {
          log('info', 'search', 'Вход через браузер: ' + source.name);
          showToast(browserSignedIn(source.name));
          onDone();
        } else if (r.result === 'busy') showToast(BROWSER_BUSY);
        else if (r.result === 'failed') showToast(BROWSER_FAILED);
        else if (r.result === 'store_failed') showToast(BROWSER_STORE_FAILED);
      },
      () => {
        // the session is kept, but the marker could not be written
        if (alive.current) setBusy(false);
        showToast(BROWSER_STORE_FAILED);
      },
    );
  };

  return (
    <>
      {suggest && (
        <div class="m-hint-warn" data-hint="browser">
          {suggest}
        </div>
      )}
      <button
        type="button"
        class={'m-btn ' + (suggest ? 'm-btn-primary' : 'm-btn-secondary')}
        data-action="browser-login"
        disabled={busy || disabled}
        onClick={open}
      >
        {BROWSER_LOGIN}
      </button>
    </>
  );
}
