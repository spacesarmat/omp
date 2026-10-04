// Android TV: the visible Cloudflare check is a native dialog (the site under the remote, «Пройти на телефоне»,
// «Отметить пультом», «Отмена»); the phone's answer is stored natively, so the page only learns the result.
// Loaded with a dynamic import on Android TV only (never part of the LG bundle).
import { nativePlugin, type OmpNativeTvPlugin } from '../platform/androidNative';
import { checkResultOf, setCloudflareChecker, tvCheckRequest, type CloudflareChecker } from './cloudflareCheck';

export function tvChecker(plugin: Pick<OmpNativeTvPlugin, 'cloudflareVisible'>): CloudflareChecker {
  return (site) => plugin.cloudflareVisible(tvCheckRequest(site)).then(checkResultOf, () => 'failed' as const);
}

/** Registers the TV checker; no-op outside the APK or with an older native side. */
export function installTvCloudflare(plugin: OmpNativeTvPlugin | null = nativePlugin()): void {
  if (plugin && typeof plugin.cloudflareVisible === 'function') setCloudflareChecker(tvChecker(plugin));
}
