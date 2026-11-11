export function isDesktopBuild(): boolean {
  return typeof __DESKTOP__ !== 'undefined' && __DESKTOP__;
}
