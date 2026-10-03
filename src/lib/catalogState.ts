// Texts of the «Каталог недоступен» state, shared by the phone and the TV.

export function catalogReason(server: string | null, online: boolean): string {
  if (!server) return 'Сервер не выбран';
  if (!online) return 'Нет подключения к сети';
  return 'Сервер «' + server + '» не отвечает';
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
  const t = timeLabel(ts);
  return 'Каталог недоступен · показан сохранённый список' + (t ? ' от ' + t : '');
}

export const CATALOG_HINT = 'Проверьте, что телефон и сервер в одной сети';
