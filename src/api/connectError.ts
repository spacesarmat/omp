// The connect failure as one line, for the TV and the phone screens.
import { t } from '../i18n';
import { errorMessage, isApiError } from './http';
import { addressForField } from './serverAddress';
import { canDetectTls } from './tlsProbe';

/**
 * «Не удалось подключиться к 192.168.1.191:8090 - проверьте адрес и порт»; a server that answered wrongly says how.
 * The address keeps https:// (only http:// goes). tls: its certificate was refused. An https server without an answer
 * where that cannot be told (LG) gets the line about certificates.
 */
export function connectErrorText(baseUrl: string, e: unknown, tls = false): string {
  // never the user:password@ of the URL on screen
  const host = addressForField(baseUrl).replace(/^(https:\/\/)?[^/?#@]*@/i, '$1').replace(/\/+$/, '');
  if (tls) return t('connect.certRefused', { host: host });
  if (isApiError(e) && (e.kind === 'http' || e.kind === 'parse')) return t('connect.unreachableWhy', { host: host, error: errorMessage(e) });
  if (/^https:/i.test(baseUrl) && isApiError(e) && e.kind === 'network' && !canDetectTls()) return t('connect.unreachableHttps', { host: host });
  return t('connect.unreachable', { host: host });
}
