// Context of the search sources on Android TV: the native http and Keystore secrets of the APK, the chosen
// TorrServer. Outside the APK (webOS, tests) the built-in sites answer «Доступно только в приложении Android».
import { t } from '../i18n';
import { client } from '../store/servers';
import { nativeSecrets, nativeSourceHttp } from '../platform/androidNative';
import type { SourceContext, SourceHttp } from './types';

export const noNative = (): string => t('sources.noNative');

const noHttp: SourceHttp = {
  get: () => Promise.reject(new Error(noNative())),
  post: () => Promise.reject(new Error(noNative())),
  clearCookies: () => Promise.resolve(),
};

export function tvSourceContext(): SourceContext {
  return { http: nativeSourceHttp() || noHttp, client: client.value, secrets: nativeSecrets() || undefined };
}
