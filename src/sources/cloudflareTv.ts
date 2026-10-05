// Android TV: the visible Cloudflare check is a native dialog (the site under the remote, «Пройти на телефоне»,
// «Отметить пультом», «Отмена»); the phone's answer is stored natively, so the page only learns the result.
// «Войти через браузер» is the same kind of native dialog (the login page, «Войти на телефоне»).
// Loaded with a dynamic import on Android TV only (never part of the LG bundle).
import { nativePlugin, type OmpNativeTvPlugin } from '../platform/androidNative';
import { checkResultOf, setCloudflareChecker, tvCheckRequest, type CloudflareChecker } from './cloudflareCheck';
import { browserOutcome, setBrowserLoginPlatform, tvLoginRequest, type BrowserLoginPlatform, type BrowserOutcome } from './browserLogin';

export function tvChecker(plugin: Pick<OmpNativeTvPlugin, 'cloudflareVisible'>): CloudflareChecker {
  return (site) => plugin.cloudflareVisible(tvCheckRequest(site)).then(checkResultOf, () => 'failed' as const);
}

/** The TV's browser login: the native dialog; the phone's staged session checked natively. */
export function tvBrowserLogin(plugin: Pick<OmpNativeTvPlugin, 'siteBrowserLogin' | 'siteSessionPending'>): BrowserLoginPlatform {
  return {
    phone: true,
    login: (spec, opts) =>
      plugin.siteBrowserLogin(tvLoginRequest(spec, !!(opts && opts.askPhone))).then(browserOutcome, () => ({ result: 'failed' }) as BrowserOutcome),
    pending: (site, check) =>
      plugin.siteSessionPending({ site, check }).then(
        (r) => ({ ok: !!r && r.ok === true, host: r && typeof r.host === 'string' ? r.host : undefined }),
        () => ({ ok: false }),
      ),
  };
}

/** Registers the TV checker and browser login; no-op outside the APK or with an older native side. */
export function installTvCloudflare(plugin: OmpNativeTvPlugin | null = nativePlugin()): void {
  if (plugin && typeof plugin.cloudflareVisible === 'function') setCloudflareChecker(tvChecker(plugin));
  if (plugin && typeof plugin.siteBrowserLogin === 'function') setBrowserLoginPlatform(tvBrowserLogin(plugin));
}
