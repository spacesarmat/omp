import { TAB_IDS } from '@/lib/nav';

/** Tab id from a legacy ?tab= link. An unknown value opens the overview. */
export function tabFromSearch(search: string) {
  const tab = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('tab') || '';
  return TAB_IDS.indexOf(tab) >= 0 ? tab : 'home';
}

/** Tab id from /admin or /admin/<section>. */
export function tabFromPath(pathname: string) {
  const clean = String(pathname || '').split('?')[0].replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : '';
  if (!last || last === 'admin') return 'home';
  return TAB_IDS.indexOf(last) >= 0 ? last : 'home';
}

/** Address of a section. Home is /admin/. Other parameters stay, except the old tab key. */
export function urlForTab(tab: string, search: string) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.delete('tab');
  const q = params.toString();
  const path = !tab || tab === 'home' ? '/admin/' : '/admin/' + tab;
  return path + (q ? '?' + q : '');
}
