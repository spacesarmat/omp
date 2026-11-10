export type DesktopRouteId = 'library' | 'news' | 'search' | 'remote' | 'settings' | 'connect';
export type DesktopSupportLevel = 'preview' | 'theme' | 'logic';

export const DESKTOP_ROUTES: ReadonlyArray<{ id: DesktopRouteId; label: string; labelEn: string; menu: boolean }> = [
  { id: 'library', label: 'Каталог', labelEn: 'Library', menu: true },
  { id: 'news', label: 'Новое', labelEn: 'New', menu: true },
  { id: 'search', label: 'Поиск', labelEn: 'Search', menu: true },
  { id: 'remote', label: 'Пульт', labelEn: 'Remote', menu: true },
  { id: 'settings', label: 'Настройки', labelEn: 'Settings', menu: true },
  { id: 'connect', label: 'Подключение', labelEn: 'Connect', menu: false },
];

export const DESKTOP_SCREEN_SUPPORT: Record<DesktopRouteId, DesktopSupportLevel> = {
  library: 'preview',
  news: 'preview',
  search: 'preview',
  remote: 'preview',
  settings: 'logic',
  connect: 'preview',
};

export function isDesktopRouteId(value: string): value is DesktopRouteId {
  return DESKTOP_ROUTES.some((route) => route.id === value);
}
