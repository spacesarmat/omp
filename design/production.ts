import {
  DESIGN_FORMATS,
  DESIGN_TARGETS,
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

  registerComponentIdentity(root, stamped);
  const initialFormat = win ? resolveProductionFormat(readWindowSize(win).width, readWindowSize(win).height) : 'landscape';
  writeContext(root, options.target, options.screenOf(), initialFormat);

  const stopLayout = observeProductionLayout(root);
  const refreshScreen = (): void => {
    writeContext(root, options.target, options.screenOf(), currentFormat());
  };
  const currentFormat = (): DesignFormat =>
    win ? resolveProductionFormat(readWindowSize(win).width, readWindowSize(win).height) : 'landscape';

  const observer = new MutationObserver(() => registerComponentIdentity(root, stamped));
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
    for (const element of stamped) delete element.dataset.designComponent;
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
