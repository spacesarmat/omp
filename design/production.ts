import {
  DESIGN_FORMATS,
  DESIGN_TARGETS,
  DESKTOP_DESIGN_TARGETS,
  type DesignFormat,
  type DesignTarget,
  type DesktopDesignTarget,
  type LayoutContext,
} from './schema.ts';
import { observeProductionLayout } from './layoutDom.ts';

// Production design integration: the app shell reports its live layout context (platform
// target, current route, portrait or landscape) on the observed root and registers stable
// layout identities on the real component markup, so the shared runtime resolves the same
// node ids the editor exported. Everything stays a no-op until an export writes a nonempty
// generated layout document.

export interface ProductionDesignOptions {
  target: DesignTarget;
  screenOf(): string | null;
  subscribeScreen?(notify: () => void): () => void;
}

export function resolveProductionFormat(width: number, height: number): DesignFormat {
  return height > width ? 'portrait' : 'landscape';
}

export function desktopTargetForPlatform(platform: string): DesktopDesignTarget {
  const id = platform.toLowerCase();
  if (id.startsWith('macos')) return 'desktop-macos';
  if (id.startsWith('linux')) return 'desktop-linux';
  return 'desktop-windows';
}

// Mirrors the preview registry: real screens share the component classes, so the same
// inference gives production nodes the stable adapter ids the editor recorded.
function componentIdOf(element: HTMLElement): string | null {
  if (element.classList.contains('m-card') || element.classList.contains('list-item')) return 'card';
  if (element.classList.contains('choice-row') || element.classList.contains('m-set-row')) return 'choice-row';
  if (element.tagName === 'BUTTON' || element.classList.contains('button')) return 'button';
  if (element.tagName === 'INPUT' || element.classList.contains('text-input')) return 'input';
  return null;
}

// The phone search tab keeps the historical route id 'add' (deep links and saved tabs), while
// the editor design space speaks 'search': exported records, nav ids and the reported screen
// all use the editor name. installProductionDesign applies the mapping to whatever screenOf
// reports, so every entry path (phone, TV, desktop) shares one alias definition.
export function desktopScreenIdOf(routeName: string | null): string | null {
  return routeName === 'add' ? 'search' : routeName;
}

const PHONE_NAV_ID_ALIAS: Record<string, string> = { add: 'search' };

// The desktop app renders the phone shell, not the editor DesktopShell, so the exported chrome
// ids do not exist in the real markup. The desktop sidebar buttons carry their route in
// data-nav; stamping the same ids the editor exports (sidebar, content, nav-<route>) lets an
// exported layout move, hide and reorder the real chrome. Runs before component inference so
// the nav buttons are not claimed as generic buttons. The sidebar/content/nav contract is
// desktop-only: phone and TV previews register a different root structure, so the shell ids
// are stamped exclusively on desktop targets while component inference runs everywhere.
function registerDesktopShellIdentity(root: HTMLElement, stamped: Set<HTMLElement>): void {
  const sidebar = root.querySelector<HTMLElement>('aside.omp-side');
  if (sidebar && !sidebar.dataset.designId && !sidebar.dataset.designComponent) {
    sidebar.dataset.designId = 'sidebar';
    sidebar.dataset.designComponent = 'sidebar';
    stamped.add(sidebar);
  }
  for (const item of root.querySelectorAll<HTMLElement>('button.omp-side-item')) {
    const nav = item.dataset.nav;
    if (!nav || item.dataset.designId || item.dataset.designComponent) continue;
    item.dataset.designId = `nav-${PHONE_NAV_ID_ALIAS[nav] ?? nav}`;
    item.dataset.designComponent = 'sidebar-item';
    stamped.add(item);
  }
  // One route screen renders at a time; it is the content area the editor wraps in
  // main.desktop-content. Alternative branches may mount several screens, the first claim
  // wins the plain id exactly like duplicate adapters in the preview.
  for (const screen of root.querySelectorAll<HTMLElement>('.m-screen')) {
    if (screen.dataset.designId || screen.dataset.designComponent) continue;
    screen.dataset.designId = 'content';
    screen.dataset.designComponent = 'content';
    stamped.add(screen);
  }
}

function registerComponentIdentity(root: HTMLElement, stamped: Set<HTMLElement>): void {
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];
  for (const element of elements) {
    if (element.dataset.designId || element.dataset.key || element.dataset.designComponent) continue;
    const id = componentIdOf(element);
    if (!id) continue;
    element.dataset.designComponent = id;
    stamped.add(element);
  }
}

function writeContext(root: HTMLElement, target: DesignTarget, screenId: string | null, format: DesignFormat): void {
  root.setAttribute('data-design-target', target);
  if (screenId) root.setAttribute('data-design-screen', screenId);
  else root.removeAttribute('data-design-screen');
  root.setAttribute('data-design-format', format);
}

function readWindowSize(win: Window): { width: number; height: number } {
  return { width: win.innerWidth, height: win.innerHeight };
}

const installedProductionRoots = new WeakSet<HTMLElement>();

export function installProductionDesign(root: HTMLElement, options: ProductionDesignOptions): () => void {
  if (installedProductionRoots.has(root)) return () => undefined;
  installedProductionRoots.add(root);
  const stamped = new Set<HTMLElement>();
  const win = root.ownerDocument.defaultView ?? (typeof window !== 'undefined' ? window : null);
  const shellIdentityTarget = (DESKTOP_DESIGN_TARGETS as readonly string[]).includes(options.target);

  const registerIdentities = (): void => {
    if (shellIdentityTarget) registerDesktopShellIdentity(root, stamped);
    registerComponentIdentity(root, stamped);
  };
  registerIdentities();
  const initialFormat = win ? resolveProductionFormat(readWindowSize(win).width, readWindowSize(win).height) : 'landscape';
  writeContext(root, options.target, desktopScreenIdOf(options.screenOf()), initialFormat);

  // The layout walk receives the registration hook: every refresh, including the ones its own
  // observer triggers on late-loading markup, stamps component ids before resolving identities.
  const stopLayout = observeProductionLayout(root, registerIdentities);
  const refreshScreen = (): void => {
    writeContext(root, options.target, desktopScreenIdOf(options.screenOf()), currentFormat());
  };
  const currentFormat = (): DesignFormat =>
    win ? resolveProductionFormat(readWindowSize(win).width, readWindowSize(win).height) : 'landscape';

  const observer = new MutationObserver(registerIdentities);
  observer.observe(root, { childList: true, subtree: true });
  let unsubscribeScreen: (() => void) | undefined;
  if (options.subscribeScreen) unsubscribeScreen = options.subscribeScreen(refreshScreen);
  const onResize = (): void => refreshScreen();
  win?.addEventListener('resize', onResize);
  win?.addEventListener('orientationchange', onResize);

  return () => {
    installedProductionRoots.delete(root);
    unsubscribeScreen?.();
    observer.disconnect();
    win?.removeEventListener('resize', onResize);
    win?.removeEventListener('orientationchange', onResize);
    stopLayout();
    for (const element of stamped) {
      delete element.dataset.designComponent;
      delete element.dataset.designId;
    }
    stamped.clear();
    root.removeAttribute('data-design-target');
    root.removeAttribute('data-design-screen');
    root.removeAttribute('data-design-format');
  };
}

// Kept for callers that only need the context the runtime reads back, e.g. tests and shells
// that manage the attributes themselves.
export function productionContextOf(root: HTMLElement): LayoutContext | null {
  const target = root.getAttribute('data-design-target');
  const screenId = root.getAttribute('data-design-screen');
  const format = root.getAttribute('data-design-format');
  if (!target || !screenId || !format) return null;
  if (!(DESIGN_TARGETS as readonly string[]).includes(target)) return null;
  if (!(DESIGN_FORMATS as readonly string[]).includes(format)) return null;
  return { target: target as DesignTarget, screenId, format: format as DesignFormat };
}
