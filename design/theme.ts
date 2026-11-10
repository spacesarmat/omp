import type { DesktopDesignTarget, DesignFormat, DesignState, OverrideScope, ThemeDocument, ThemeOverride, TokenMap } from './schema';

export interface ThemeContext {
  target: DesktopDesignTarget;
  screenId: string;
  componentId?: string;
  elementId?: string;
  format: DesignFormat;
  state: DesignState;
}

const RANK: Record<OverrideScope, number> = {
  target: 1,
  component: 2,
  screen: 3,
  element: 4,
  format: 5,
  state: 6,
};

function matches(override: ThemeOverride, context: ThemeContext): boolean {
  if (override.target !== undefined && override.target !== context.target) return false;
  if (override.componentId !== undefined && override.componentId !== context.componentId) return false;
  if (override.screenId !== undefined && override.screenId !== context.screenId) return false;
  if (override.elementId !== undefined && override.elementId !== context.elementId) return false;
  if (override.format !== undefined && override.format !== context.format) return false;
  return override.state === undefined || override.state === context.state;
}

function activeOverrides(theme: ThemeDocument, context: ThemeContext): ThemeOverride[] {
  return theme.overrides
    .map((override, index) => ({ override, index }))
    .filter(({ override }) => matches(override, context))
    .sort((a, b) => RANK[a.override.scope] - RANK[b.override.scope] || a.index - b.index)
    .map(({ override }) => override);
}

export function activeOverrideIds(theme: ThemeDocument, context: ThemeContext): string[] {
  return activeOverrides(theme, context).map((override) => override.id);
}

export function resolveThemeTokens(theme: ThemeDocument, context: ThemeContext): TokenMap {
  const result = { ...theme.tokens };
  for (const override of activeOverrides(theme, context)) Object.assign(result, override.tokens);
  return result;
}

function declarations(tokens: TokenMap): string {
  return Object.keys(tokens)
    .sort()
    .map((key) => `  ${key}: ${tokens[key]};`)
    .join('\n');
}

export function generateThemeCss(theme: ThemeDocument, target: DesktopDesignTarget): string {
  const blocks = [`:root {\n${declarations(theme.tokens)}\n}`];
  const overrides = theme.overrides
    .map((override, index) => ({ override, index }))
    .filter(({ override }) => override.target === undefined || override.target === target)
    .sort((a, b) => RANK[a.override.scope] - RANK[b.override.scope] || a.index - b.index);
  for (const { override } of overrides) {
    blocks.push(`[data-design-overrides~="${override.id}"] {\n${declarations(override.tokens)}\n}`);
  }
  return `${blocks.join('\n\n')}\n`;
}
