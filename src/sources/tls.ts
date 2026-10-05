// A site whose certificate the native http could not verify (android/.../sources/SiteHttp.kt CODE_TLS / TLS_ERROR):
// an incomplete chain, an unknown CA, a wrong host name. The site did answer, so its health says «Ошибка сертификата
// сайта», not «не отвечает». The phone gets the code 'tls'; the background monitor page gets the message only, so the
// native texts of both languages are matched too. Shared by the phone and the TV bundles: Chromium 53 rules.
import { t } from '../i18n';
import { ru } from '../i18n/ru';
import { en } from '../i18n/en';

export const TLS = 'tls';

/** What the person sees (the current language). */
export const tlsText = (): string => t('sources.state.tls');

/** The message is the certificate error: the native text (either language) or the shown one. */
export function isTlsMessage(m: unknown): boolean {
  return typeof m === 'string' && (m === ru.sources.state.tls || m === en.sources.state.tls || m === tlsText());
}

/** A failed site request because the site's certificate could not be verified. */
export function isTlsError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as { code?: unknown; message?: unknown };
  return o.code === TLS || isTlsMessage(o.message);
}
