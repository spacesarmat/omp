import { describe, expect, it } from 'vitest';
import { createDefaultFlow, createDefaultTheme } from '../../design/defaults';
import { DesignValidationError, parseFlowDocument, parseThemeDocument } from '../../design/validation';

const BASE = '0000000000000000000000000000000000000000';

describe('design document schema', () => {
  it('accepts independent defaults with current OMP colors', () => {
    const theme = parseThemeDocument(createDefaultTheme(BASE));
    expect(theme.schemaVersion).toBe(1);
    expect(theme.tokens['--omp-color-accent']).toBe('#F5B700');
    expect(theme.releaseIntents).toEqual([]);
    const flow = parseFlowDocument(createDefaultFlow(BASE));
    expect(flow.rules.some((rule) => rule.action.type === 'navigate' && rule.action.screenId === 'library')).toBe(true);
    expect(flow.rules.some((rule) => rule.action.type === 'navigate' && rule.action.screenId === 'connect')).toBe(true);
  });

  it('rejects unknown fields and executable content', () => {
    expect(() => parseThemeDocument({ ...createDefaultTheme(BASE), extra: true })).toThrow(DesignValidationError);
    expect(() => parseThemeDocument({ ...createDefaultTheme(BASE), ['__proto__']: { polluted: true } })).toThrow(DesignValidationError);
    expect(() => parseThemeDocument({ ...createDefaultTheme(BASE), tokens: { '--omp-color-accent': 'url(javascript:alert(1))' } })).toThrow(DesignValidationError);
    expect(() => parseFlowDocument({
      ...createDefaultFlow(BASE),
      rules: [{ id: 'x', screenId: 'settings', elementId: 'x', event: 'click', action: { type: 'eval', code: 'alert(1)' } }],
    })).toThrow(DesignValidationError);
  });

  it('rejects an altered prototype instead of reading inherited values', () => {
    const value = Object.assign(Object.create({ inherited: true }), createDefaultTheme(BASE));
    expect(() => parseThemeDocument(value)).toThrow(DesignValidationError);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects malformed commits, duplicate ids and duplicate release targets', () => {
    expect(() => parseThemeDocument(createDefaultTheme('not-a-commit'))).toThrow(DesignValidationError);
    const duplicateOverrides = createDefaultTheme(BASE);
    duplicateOverrides.overrides.push(
      { id: 'same', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } },
      { id: 'same', scope: 'target', target: 'desktop-macos', tokens: { '--omp-color-accent': '#222222' } },
    );
    expect(() => parseThemeDocument(duplicateOverrides)).toThrow(DesignValidationError);
    const duplicateTargets = createDefaultTheme(BASE);
    duplicateTargets.releaseIntents.push(
      { target: 'desktop-windows', version: '1.0.0-beta.1', channel: 'beta' },
      { target: 'desktop-windows', version: '1.0.0-beta.2', channel: 'beta' },
    );
    expect(() => parseThemeDocument(duplicateTargets)).toThrow(DesignValidationError);
  });

  it('rejects unknown, negative and oversized token values', () => {
    for (const tokens of [
      { '--unknown': '#111111' },
      { '--omp-size-space': '-1px' },
      { '--omp-size-space': '513px' },
      { '--omp-size-space': '1.234px' },
      { '--omp-color-accent': '#abcd' },
    ]) {
      expect(() => parseThemeDocument({ ...createDefaultTheme(BASE), tokens })).toThrow(DesignValidationError);
    }
  });

  it('rejects missing scope selectors and unsupported conditions', () => {
    const withoutTarget = createDefaultTheme(BASE);
    withoutTarget.overrides.push({ id: 'bad', scope: 'target', tokens: { '--omp-color-accent': '#111111' } });
    expect(() => parseThemeDocument(withoutTarget)).toThrow(DesignValidationError);
    const badFlow = createDefaultFlow(BASE);
    badFlow.rules.push({
      id: 'bad-condition',
      screenId: 'settings',
      elementId: 'settings-continue',
      event: 'click',
      condition: { kind: 'eq', path: 'window.location' as never, value: 'https://attacker.invalid' },
      action: { type: 'toast', message: 'bad' },
    });
    expect(() => parseFlowDocument(badFlow)).toThrow(DesignValidationError);
  });
});
