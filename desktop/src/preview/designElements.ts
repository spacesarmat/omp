import { activeOverrideIds, resolveThemeTokens, type ThemeContext } from '../../../design/theme.ts';
import type { ThemeDocument } from '../../../design/schema.ts';

const REGISTERED = new Set(['legacy-page', 'button', 'input', 'card', 'choice-row']);

function componentId(element: Element): string | null {
  if (element.classList.contains('m-card') || element.classList.contains('list-item')) return 'card';
  if (element.classList.contains('choice-row') || element.classList.contains('m-set-row')) return 'choice-row';
  if (element.tagName === 'BUTTON' || element.classList.contains('button')) return 'button';
  if (element.tagName === 'INPUT' || element.classList.contains('text-input')) return 'input';
  return null;
}

function applyAliases(element: HTMLElement, theme: ThemeDocument, context: ThemeContext): void {
  const tokens = resolveThemeTokens(theme, context);
  const aliases: Record<string, string> = {
    '--bg': tokens['--omp-color-background'],
    '--panel': tokens['--omp-color-panel'],
    '--panel-2': `color-mix(in srgb, ${tokens['--omp-color-panel']} 92%, ${tokens['--omp-color-text']})`,
    '--panel2': `color-mix(in srgb, ${tokens['--omp-color-panel']} 92%, ${tokens['--omp-color-text']})`,
    '--accent': tokens['--omp-color-accent'],
    '--text': tokens['--omp-color-text'],
    '--muted': tokens['--omp-color-muted'],
    '--danger': tokens['--omp-color-danger'],
  };
  for (const [name, value] of Object.entries(aliases)) element.style.setProperty(name, value);
}

export function decorateDesignElements(root: HTMLElement, theme: ThemeDocument, context: ThemeContext): void {
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];
  for (const element of elements) {
    const existing = element.dataset.designId;
    if (existing && !REGISTERED.has(existing)) continue;
    const id = existing || componentId(element);
    if (!id || !REGISTERED.has(id)) continue;
    const elementContext = { ...context, componentId: id, elementId: id };
    element.dataset.designId = id;
    element.dataset.designComponent = id;
    element.dataset.designOverrides = activeOverrideIds(theme, elementContext).join(' ');
    applyAliases(element, theme, elementContext);
  }
}

export function observeDesignElements(root: HTMLElement, theme: ThemeDocument, context: ThemeContext): () => void {
  const refresh = () => decorateDesignElements(root, theme, context);
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
