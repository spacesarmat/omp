import { TAB_IDS } from '@/lib/nav';

/** Tab id from the address. An unknown value opens the overview. */
export function tabFromSearch(search: string) {
  const tab = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('tab') || '';
  return TAB_IDS.indexOf(tab) >= 0 ? tab : 'home';
}

/** Address of a section. Home omits the tab parameter. Other parameters stay. */
export function urlForTab(tab: string, search: string) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (!tab || tab === 'home') params.delete('tab');
  else params.set('tab', tab);
  const q = params.toString();
  return '/admin/' + (q ? '?' + q : '');
}
