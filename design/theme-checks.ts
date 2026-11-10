import type { DesktopDesignTarget, DesignFormat, DesignState, ThemeDocument } from './schema.ts';
import { resolveThemeTokens, type ThemeContext } from './theme.ts';

export interface DesignIssue {
  code: 'CONTRAST' | 'FONT_SIZE';
  target: DesktopDesignTarget;
  screenId: string;
  elementId?: string;
  format: DesignFormat;
  state: DesignState;
  token: string;
  message: string;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const PAIRS: Array<{ first: string; second: string; minimum: number }> = [
  { first: '--omp-color-text', second: '--omp-color-background', minimum: 4.5 },
  { first: '--omp-color-text', second: '--omp-color-panel', minimum: 4.5 },
  { first: '--omp-color-muted', second: '--omp-color-panel', minimum: 4.5 },
  { first: '--omp-color-background', second: '--omp-color-accent', minimum: 4.5 },
  { first: '--omp-color-panel', second: '--omp-color-accent', minimum: 3 },
];

export function checkTheme(theme: ThemeDocument, contexts: ThemeContext[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  for (const context of contexts) {
    const tokens = resolveThemeTokens(theme, context);
    const base = {
      target: context.target,
      screenId: context.screenId,
      elementId: context.elementId,
      format: context.format,
      state: context.state,
    };
    for (const pair of PAIRS) {
      const ratio = contrast(tokens[pair.first], tokens[pair.second]);
      if (ratio < pair.minimum) {
        issues.push({
          ...base,
          code: 'CONTRAST',
          token: pair.first,
          message: `${pair.first} on ${pair.second} has contrast ${ratio.toFixed(2)}:1, expected at least ${pair.minimum}:1`,
        });
      }
    }
    if (Number.parseFloat(tokens['--omp-size-font']) < 14) {
      issues.push({
        ...base,
        code: 'FONT_SIZE',
        token: '--omp-size-font',
        message: 'Desktop font size must be at least 14px',
      });
    }
  }
  return issues;
}
