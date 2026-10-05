// The visible Cloudflare check on the phone (spec §3, mockup PhoneCloudflare): a native sheet with the site,
// «Подтвердите, что вы не робот». Two ways in: a search on the phone hits a check that needs a person, or the paired
// Android TV asks «Пройти на телефоне» (the native side long-polls the TV and keeps the request; the cookies go from the
// native side straight to that TV, never through the page). The phone listens to the TV only while a TV is paired and
// a site has its Cloudflare switch on (or a site with «Войти через браузер» is on), and opens a TV request only for such
// a site. «Войти через браузер» (browserLogin.ts) is registered here too: the phone's sheet with the site's login page,
// and the TV's «Войти на телефоне» (a TV request of kind 'login': the session goes natively straight to that TV).
// Logged with the site name only.
import { effect, signal } from '@preact/signals';
import { native, type OmpNativeApi, type TvCloudflareRequest } from './platform/native';
import { activeTv, isAtv, ATV_PORT, type SavedTv } from './tv/tvStore';
import { showToast } from './ui/toast';
import { log } from '../../src/lib/log';
import { logCloudflare } from '../../src/sources/cloudflare';
import { isSourceOn, onCloudflareBypassChange, onHealthChange } from '../../src/sources/store';
import { allSources } from '../../src/sources/registry';
import {
  BROWSER_BUSY,
  BROWSER_FAILED,
  BROWSER_NOT_SENT_TV,
  BROWSER_SENT_TV,
  browserOutcome,
  phoneLoginRequest,
  setBrowserLoginPlatform,
  WATCH_NOTIFY_LOGIN,
  type BrowserLoginPlatform,
  type BrowserOutcome,
} from '../../src/sources/browserLogin';
import type { Source } from '../../src/sources/types';
import {
  anyBypassOn,
  CHECK_BUSY,
  CHECK_FAILED,
  checkResultOf,
  NOT_SENT_TO_TV,
  phoneCheckRequest,
  SENT_TO_TV,
  setCloudflareChecker,
  tvRequestSource,
  WATCH_NOTIFY,
  type CloudflareChecker,
} from '../../src/sources/cloudflareCheck';

type CfNative = Pick<
  OmpNativeApi,
  'cloudflareVisible' | 'cloudflareWatch' | 'cloudflarePending' | 'cloudflareDecline' | 'onCloudflareRequest' | 'siteBrowserLogin'
>;

export interface PhoneCloudflareDeps {
  native: CfNative;
  toast: (text: string) => void;
  /** Reactive (read inside an effect): the TV in use. */
  tv: () => SavedTv | null;
  /** A site behind Cloudflare has its switch on (re-read when a switch changes). */
  bypassOn: () => boolean;
  /** Subscribes to the page becoming visible again; returns the unsubscribe. */
  onVisible: (cb: () => void) => () => void;
}

const realDeps: PhoneCloudflareDeps = {
  native,
  toast: (t) => showToast(t),
  tv: () => activeTv.value,
  bypassOn: () => anyBypassOn() || anyBrowserLoginOn(),
  onVisible: (cb) => {
    const h = () => {
      if (document.visibilityState === 'visible') cb();
    };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  },
};

/** A site with «Войти через браузер» takes part in the search (the TV may then ask «Войти на телефоне»). */
export function anyBrowserLoginOn(list: Source[] = allSources()): boolean {
  return list.some((s) => !!s.browserLogin && !!s.browserSpec && isSourceOn(s));
}

/** The phone's browser login: the native sheet with the site's login page. */
export function phoneBrowserLogin(n: Pick<OmpNativeApi, 'siteBrowserLogin'>): BrowserLoginPlatform {
  return {
    login: (spec) => n.siteBrowserLogin(phoneLoginRequest(spec)).then(browserOutcome, () => ({ result: 'failed' }) as BrowserOutcome),
  };
}

/**
 * The source a TV «Войти на телефоне» may open: a registered site with a browser login whose hosts include the request's
 * root exactly (https://host/). null for anything else.
 */
export function tvLoginSource(r: TvCloudflareRequest, list: Source[] = allSources()): Source | null {
  const s = r.source ? list.filter((x) => x.id === r.source)[0] : undefined;
  if (!s || !s.browserSpec || !s.sessionHosts) return null;
  const roots = s.sessionHosts().map((h) => 'https://' + h + '/');
  return roots.indexOf(r.url) >= 0 ? s : null;
}

/** The TV asked the phone to sign in: the sheet with the site's login page; the session goes natively to that TV. */
function handleTvLogin(r: TvCloudflareRequest, deps: PhoneCloudflareDeps): Promise<void> {
  const source = tvLoginSource(r);
  if (!source) {
    log('warn', 'tv', 'Вход: телевизор попросил вход для неизвестного сайта — отклонено');
    return deps.native.cloudflareDecline(r.id).then(undefined, () => undefined);
  }
  const tv = deps.tv();
  const req = phoneLoginRequest(source.browserSpec!(), { id: r.id, tv: tv ? tv.name : 'Телевизор' });
  return deps.native.siteBrowserLogin(req).then(
    (res) => {
      const x = browserOutcome(res);
      if (x.done) return;
      if (x.result === 'ok') {
        if (x.sent) log('info', 'tv', 'Вход через браузер передан на телевизор · ' + source.name);
        else log('warn', 'tv', 'Вход через браузер не передан на телевизор · ' + source.name);
        deps.toast(x.sent ? BROWSER_SENT_TV : BROWSER_NOT_SENT_TV);
      } else if (x.result === 'busy') deps.toast(BROWSER_BUSY);
      else if (x.result === 'failed') deps.toast(BROWSER_FAILED);
    },
    () => undefined,
  );
}

/** The phone's own check: the sheet without the TV line. */
export function phoneChecker(n: Pick<OmpNativeApi, 'cloudflareVisible'>): CloudflareChecker {
  return (site) => n.cloudflareVisible(phoneCheckRequest(site)).then(checkResultOf, () => 'failed' as const);
}

// requests already handled (the live event and the pending one are the same request)
let shown: { [id: string]: true } = {};

/** Forgets the handled requests (tests). */
export function resetTvRequests(): void {
  shown = {};
}

/**
 * The TV asked: only for a site this phone knows to be behind Cloudflare with its switch on (exact site root), shown
 * under the phone's own name for it; anything else is declined without a sheet. The result goes to the TV natively, the
 * phone says whether it got there.
 */
export function handleTvRequest(r: TvCloudflareRequest, deps: PhoneCloudflareDeps = realDeps): Promise<void> {
  if (shown[r.id]) return Promise.resolve();
  shown[r.id] = true;
  if (r.kind === 'login') return handleTvLogin(r, deps);
  const source = tvRequestSource(r.url);
  if (!source) {
    log('warn', 'tv', 'Cloudflare: телевизор попросил проверку для неизвестного сайта — отклонено');
    return deps.native.cloudflareDecline(r.id).then(undefined, () => undefined);
  }
  const tv = deps.tv();
  const req = phoneCheckRequest({ name: source.name, url: r.url }, { id: r.id, tv: tv ? tv.name : 'Телевизор' });
  return deps.native.cloudflareVisible(req).then(
    (res) => {
      // the TV passed it itself meanwhile: nothing to say
      if (res && res.result === 'done') return;
      const x = checkResultOf(res);
      if (x === 'solved') {
        const sent = !!res && res.sent === true;
        if (sent) logCloudflare('passed', source.name);
        else log('warn', 'tv', 'Cloudflare: разрешение не передано на телевизор · ' + source.name);
        deps.toast(sent ? SENT_TO_TV : NOT_SENT_TO_TV);
      } else if (x === 'busy') deps.toast(CHECK_BUSY);
      else if (x === 'failed') deps.toast(CHECK_FAILED);
    },
    // the TV no longer waits for it
    () => undefined,
  );
}

/** The control server address of a paired Android TV, null for any other TV. */
export function watchTarget(tv: SavedTv | null): { url: string; token: string; notify: string; notifyLogin: string } | null {
  if (!tv || !isAtv(tv) || !tv.token) return null;
  return { url: 'http://' + tv.ip + ':' + (tv.ctlPort || ATV_PORT), token: tv.token, notify: WATCH_NOTIFY, notifyLogin: WATCH_NOTIFY_LOGIN };
}

/** Registers the phone checker, watches the paired Android TV while a switch is on, shows its requests. */
export function installPhoneCloudflare(deps: PhoneCloudflareDeps = realDeps): () => void {
  setCloudflareChecker(phoneChecker(deps.native));
  setBrowserLoginPlatform(phoneBrowserLogin(deps.native));
  const switches = signal(0);
  const offSwitch = onCloudflareBypassChange(() => {
    switches.value++;
  });
  // a login (browser or form) changes a site's health: the browser-login sites may need the watch now
  const offHealth = onHealthChange(() => {
    switches.value++;
  });
  // null: nothing told yet (the first run tells the native side either way)
  let last: string | null = null;
  const stopWatch = effect(() => {
    void switches.value;
    const t = deps.bypassOn() ? watchTarget(deps.tv()) : null;
    const key = t ? t.url + ' ' + t.token : '';
    if (key === last) return;
    last = key;
    deps.native.cloudflareWatch(t).then(undefined, () => undefined);
  });
  const offEvent = deps.native.onCloudflareRequest((r) => {
    void handleTvRequest(r, deps);
  });
  const pending = () => {
    deps.native.cloudflarePending().then(
      (r) => {
        if (r) void handleTvRequest(r, deps);
      },
      () => undefined,
    );
  };
  pending();
  const offVisible = deps.onVisible(pending);
  return () => {
    stopWatch();
    offSwitch();
    offHealth();
    offEvent();
    offVisible();
    setCloudflareChecker(null);
    setBrowserLoginPlatform(null);
  };
}
