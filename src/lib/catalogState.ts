// Texts of the «Каталог недоступен» state, shared by the phone and the TV.
import { t } from '../i18n';

export function catalogReason(server: string | null, online: boolean): string {
  if (!server) return t('errors.noServerSelected');
  if (!online) return t('server.offline');
  return t('server.notAnswering', { server });
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function timeLabel(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function cachedBanner(ts: number): string {
  const time = timeLabel(ts);
  return time ? t('server.catalogCachedAt', { time }) : t('server.catalogCached');
}

export const catalogHint = () => t('server.catalogHint');
