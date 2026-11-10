import { activeOverrideIds, type ThemeContext } from '../../../design/theme.ts';
import type { ThemeDocument } from '../../../design/schema.ts';

export function designOverrideAttrs(theme: ThemeDocument, context: ThemeContext): { 'data-design-overrides': string } {
  return { 'data-design-overrides': activeOverrideIds(theme, context).join(' ') };
}
