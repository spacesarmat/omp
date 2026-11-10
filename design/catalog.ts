import type { DesignFormat, DesignState, DesktopDesignTarget, ThemeOverride, TokenMap } from './schema.ts';

export type DesignPropertyKind = 'color' | 'px';

export interface DesignPropertyDef {
  token: string;
  label: string;
  kind: DesignPropertyKind;
}

export interface DesignElementDef {
  id: string;
  componentId: string;
  label: string;
  fields: DesignPropertyDef[];
}

export const DESIGN_ELEMENTS: DesignElementDef[] = [
  {
    id: 'sidebar',
    componentId: 'sidebar',
    label: 'Боковое меню',
    fields: [
      { token: '--omp-color-panel', label: 'Фон панели', kind: 'color' },
      { token: '--omp-size-sidebar', label: 'Ширина панели', kind: 'px' },
    ],
  },
  {
    id: 'sidebar-item',
    componentId: 'sidebar-item',
    label: 'Пункт меню',
    fields: [
      { token: '--omp-color-accent', label: 'Акцент', kind: 'color' },
      { token: '--omp-color-text', label: 'Текст', kind: 'color' },
      { token: '--omp-size-radius', label: 'Радиус', kind: 'px' },
    ],
  },
  {
    id: 'content',
    componentId: 'content',
    label: 'Контент',
    fields: [
      { token: '--omp-color-background', label: 'Фон', kind: 'color' },
      { token: '--omp-size-space', label: 'Отступ', kind: 'px' },
      { token: '--omp-size-font', label: 'Размер текста', kind: 'px' },
    ],
  },
  {
    id: 'settings-continue',
    componentId: 'button',
    label: 'Кнопка продолжить',
    fields: [
      { token: '--omp-color-accent', label: 'Акцент', kind: 'color' },
      { token: '--omp-color-text', label: 'Текст', kind: 'color' },
      { token: '--omp-size-radius', label: 'Радиус', kind: 'px' },
      { token: '--omp-size-space', label: 'Отступ', kind: 'px' },
    ],
  },
];

export function findDesignElement(id: string): DesignElementDef | undefined {
  if (id.startsWith('nav-')) return DESIGN_ELEMENTS.find((entry) => entry.id === 'sidebar-item');
  return DESIGN_ELEMENTS.find((entry) => entry.id === id);
}

export type EditorOverrideScope = 'platform' | 'screen' | 'element' | 'format' | 'state';

export interface OverrideIdentity {
  scope: EditorOverrideScope;
  target: DesktopDesignTarget;
  screenId: string;
  elementId: string;
  format: DesignFormat;
  state: DesignState;
}

export function overrideId(identity: OverrideIdentity): string {
  const source = JSON.stringify(identity);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619) >>> 0;
  return `override-${identity.scope}-${hash.toString(16).padStart(8, '0')}`;
}

export function buildOverride(identity: OverrideIdentity, tokens: TokenMap): ThemeOverride {
  const result: ThemeOverride = {
    id: overrideId(identity),
    scope: identity.scope === 'platform' ? 'target' : identity.scope,
    target: identity.target,
    tokens,
  };
  if (identity.scope !== 'platform') result.screenId = identity.screenId;
  if (identity.scope === 'element' || identity.scope === 'format' || identity.scope === 'state') result.elementId = identity.elementId;
  if (identity.scope === 'format' || identity.scope === 'state') result.format = identity.format;
  if (identity.scope === 'state') result.state = identity.state;
  return result;
}
