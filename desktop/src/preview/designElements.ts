import { activeOverrideIds, type ThemeContext } from '../../../design/theme.ts';
import type { ThemeDocument } from '../../../design/schema.ts';

const REGISTERED = new Set(['legacy-page', 'button', 'input', 'card', 'choice-row']);

function componentId(element: Element): string | null {
  if (element.classList.contains('m-card') || element.classList.contains('list-item')) return 'card';
  if (element.classList.contains('choice-row') || element.classList.contains('m-set-row')) return 'choice-row';
  if (element.tagName === 'BUTTON' || element.classList.contains('button')) return 'button';
  if (element.tagName === 'INPUT' || element.classList.contains('text-input')) return 'input';
  return null;
}

export function decorateDesignElements(root: HTMLElement, theme: ThemeDocument, context: ThemeContext): void {
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];
  for (const element of elements) {
    const existing = element.dataset.designId;
    if (existing && !REGISTERED.has(existing)) continue;
    const id = existing || componentId(element);
    if (!id || !REGISTERED.has(id)) continue;
    element.dataset.designId = id;
    element.dataset.designComponent = id;
    element.dataset.designOverrides = activeOverrideIds(theme, { ...context, componentId: id, elementId: id }).join(' ');
  }
}

export function observeDesignElements(root: HTMLElement, theme: ThemeDocument, context: ThemeContext): () => void {
  const refresh = () => decorateDesignElements(root, theme, context);
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
