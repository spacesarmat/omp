import type { FlowDocument, InteractionRule, ThemeDocument } from './schema';

const NAVIGATION: Array<{ id: 'library' | 'news' | 'search' | 'remote' | 'settings'; label: string }> = [
  { id: 'library', label: 'Каталог' },
  { id: 'news', label: 'Новое' },
  { id: 'search', label: 'Поиск' },
  { id: 'remote', label: 'Пульт' },
  { id: 'settings', label: 'Настройки' },
];

export function createDefaultTheme(baseCommit: string): ThemeDocument {
  return {
    schemaVersion: 1,
    id: 'default',
    name: 'OMP Default',
    baseCommit,
    tokens: {
      '--omp-color-background': '#0F1115',
      '--omp-color-panel': '#181B22',
      '--omp-color-text': '#E8EAF0',
      '--omp-color-accent': '#F5B700',
      '--omp-color-muted': '#9AA1B2',
      '--omp-color-danger': '#E5484D',
      '--omp-size-space': '16px',
      '--omp-size-font': '16px',
      '--omp-size-sidebar': '240px',
      '--omp-size-radius': '12px',
    },
    overrides: [],
    releaseIntents: [],
    layout: { containers: [], placements: [] },
    stylePresets: [],
  };
}

function navigationRules(): InteractionRule[] {
  return NAVIGATION.map((item) => ({
    id: `nav-${item.id}`,
    screenId: '*',
    elementId: `nav-${item.id}`,
    event: 'click',
    action: { type: 'navigate', screenId: item.id },
  }));
}

export function createDefaultFlow(baseCommit: string): FlowDocument {
  return {
    schemaVersion: 1,
    id: 'desktop-default',
    baseCommit,
    rules: navigationRules().concat([
      {
        id: 'settings-continue-connected',
        screenId: 'settings',
        elementId: 'settings-continue',
        event: 'click',
        condition: { kind: 'eq', path: 'server.connected', value: true },
        action: { type: 'navigate', screenId: 'library' },
      },
      {
        id: 'settings-continue-disconnected',
        screenId: 'settings',
        elementId: 'settings-continue',
        event: 'click',
        condition: { kind: 'eq', path: 'server.connected', value: false },
        action: { type: 'navigate', screenId: 'connect' },
      },
    ]),
  };
}

export const DEFAULT_NAVIGATION = NAVIGATION;
