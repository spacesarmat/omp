import { activeOverrideIds, type ThemeContext } from '../../../design/theme.ts';
import { DESIGN_STATES, type ThemeDocument } from '../../../design/schema.ts';

export function designOverrideAttrs(theme: ThemeDocument, context: ThemeContext): { 'data-design-overrides': string } {
  const ids = activeOverrideIds(theme, context);
  for (const state of DESIGN_STATES) {
    if (state === 'default') continue;
    const active = activeOverrideIds(theme, { ...context, state });
    for (const override of theme.overrides) {
      if (override.state === state && active.includes(override.id)) ids.push(override.id);
    }
  }
  return { 'data-design-overrides': [...new Set(ids)].join(' ') };
}
