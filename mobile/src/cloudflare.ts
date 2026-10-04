// The visible Cloudflare check on the phone (spec §3, mockup PhoneCloudflare): a native sheet with the site,
// «Подтвердите, что вы не робот». Two ways in: a search on the phone hits a check that needs a person, or the paired
// Android TV asks «Пройти на телефоне» (the native side long-polls the TV and keeps the request; the cookies go from the
// native side straight to that TV, never through the page). The phone listens to the TV only while a TV is paired and
// a site has its Cloudflare switch on, and opens a TV request only for such a site. Logged with the site name only.
import { effect, signal } from '@preact/signals';
import { native, type OmpNativeApi, type TvCloudflareRequest } from './platform/native';
import { activeTv, isAtv, ATV_PORT, type SavedTv } from './tv/tvStore';
import { showToast } from './ui/toast';
import { log } from '../../src/lib/log';
import { logCloudflare } from '../../src/sources/cloudflare';
import { onCloudflareBypassChange } from '../../src/sources/store';
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

type CfNative = Pick<OmpNativeApi, 'cloudflareVisible' | 'cloudflareWatch' | 'cloudflarePending' | 'cloudflareDecline' | 'onCloudflareRequest'>;

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
  bypassOn: () => anyBypassOn(),
  onVisible: (cb) => {
    const h = () => {
      if (document.visibilityState === 'visible') cb();
    };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  },
};

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
export function watchTarget(tv: SavedTv | null): { url: string; token: string; notify: string } | null {
  if (!tv || !isAtv(tv) || !tv.token) return null;
  return { url: 'http://' + tv.ip + ':' + (tv.ctlPort || ATV_PORT), token: tv.token, notify: WATCH_NOTIFY };
}

/** Registers the phone checker, watches the paired Android TV while a switch is on, shows its requests. */
export function installPhoneCloudflare(deps: PhoneCloudflareDeps = realDeps): () => void {
  setCloudflareChecker(phoneChecker(deps.native));
  const switches = signal(0);
  const offSwitch = onCloudflareBypassChange(() => {
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
    offEvent();
    offVisible();
    setCloudflareChecker(null);
  };
}
