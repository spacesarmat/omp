import { DESIGN_TARGETS, type DesignFormat, type DesignTarget } from '../../design/schema.ts';
import { DESKTOP_ROUTES, type DesktopRouteId } from '../../desktop/src/shell/routes.ts';

export interface EditorPage {
  id: DesktopRouteId;
  label: string;
  labelEn: string;
}

const PHONE_PAGES: EditorPage[] = DESKTOP_ROUTES.map(({ id, label, labelEn }) => ({ id, label, labelEn }));
const TV_PAGES: EditorPage[] = [
  { id: 'library', label: 'Главная', labelEn: 'Home' },
  { id: 'search', label: 'Поиск', labelEn: 'Search' },
  { id: 'settings', label: 'Настройки', labelEn: 'Settings' },
  { id: 'connect', label: 'Подключение', labelEn: 'Connect' },
];

export const EDITOR_TARGET_LABELS: Record<DesignTarget, string> = {
  'desktop-windows': 'Windows',
  'desktop-macos': 'macOS',
  'desktop-linux': 'Linux',
  'android-phone': 'Android phone',
  'android-tv': 'Android TV',
  'lg-webos': 'LG webOS',
};

export function isDesktopTarget(target: DesignTarget): boolean {
  return target.startsWith('desktop-');
}

export function isTvTarget(target: DesignTarget): boolean {
  return target === 'android-tv' || target === 'lg-webos';
}

export function getEditorPages(target: DesignTarget): EditorPage[] {
  if (target === 'android-phone') return PHONE_PAGES;
  if (isTvTarget(target)) return TV_PAGES;
  return DESKTOP_ROUTES.map(({ id, label, labelEn }) => ({ id, label, labelEn }));
}

export function getEditorViewport(target: DesignTarget, format: DesignFormat): { width: number; height: number } {
  if (isTvTarget(target)) return { width: 1920, height: 1080 };
  if (target === 'android-phone') return format === 'portrait' ? { width: 720, height: 960 } : { width: 960, height: 720 };
  return format === 'portrait' ? { width: 720, height: 960 } : { width: 1280, height: 720 };
}

export function isEditorRoute(target: DesignTarget, route: string): route is DesktopRouteId {
  return getEditorPages(target).some((page) => page.id === route);
}

export function getDefaultElementId(target: DesignTarget): 'content' | 'legacy-page' {
  return isDesktopTarget(target) ? 'content' : 'legacy-page';
}

export { DESIGN_TARGETS };
