import { describe, expect, it } from 'vitest';
import { createDefaultFlow, createDefaultTheme } from '../../design/defaults';
import type { LayoutContainer, LayoutPlacement } from '../../design/schema';
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

  it('requires complete base tokens but permits partial override maps', () => {
    expect(() => parseThemeDocument({ ...createDefaultTheme(BASE), tokens: {} })).toThrow(DesignValidationError);
    const partial = createDefaultTheme(BASE);
    partial.overrides.push({ id: 'partial', scope: 'element', elementId: 'sidebar', tokens: { '--omp-color-panel': '#112233' } });
    expect(parseThemeDocument(partial).overrides[0].tokens).toEqual({ '--omp-color-panel': '#112233' });
  });
});

function placement(patch: Partial<LayoutPlacement> = {}): LayoutPlacement {
  return {
    id: 'placement-card-a',
    target: 'desktop-windows',
    screenId: 'library',
    format: 'landscape',
    nodeId: 'card-a',
    mode: 'flow',
    x: 0,
    y: 0,
    anchor: 'top-left',
    width: 'auto',
    height: 'auto',
    zIndex: 0,
    hidden: false,
    locked: false,
    label: 'Card A',
    ...patch,
  };
}

describe('layout schema validation', () => {
  it('accepts empty layout collections and style presets', () => {
    const theme = createDefaultTheme(BASE);
    expect(parseThemeDocument(theme)).toEqual(theme);
    theme.stylePresets?.push({ id: 'bright-accent', name: 'Bright accent', tokens: { '--omp-color-accent': '#FFD34D' } });
    const parsed = parseThemeDocument(theme);
    expect(parsed.stylePresets?.[0].tokens).toEqual({ '--omp-color-accent': '#FFD34D' });
  });

  it('rejects unknown mode, anchors, directions and negative or oversized geometry', () => {
    for (const patch of [
      { mode: 'grid' },
      { anchor: 'center' },
      { x: -1 },
      { y: 10001 },
      { width: -5 },
      { width: 10001 },
      { height: 12.5 },
      { zIndex: 1000 },
      { zIndex: -1 },
    ] as Array<Partial<LayoutPlacement>>) {
      const theme = createDefaultTheme(BASE);
      theme.layout?.placements.push(placement(patch));
      expect(() => parseThemeDocument(theme), JSON.stringify(patch)).toThrow(DesignValidationError);
    }

    for (const container of [
      { direction: 'diagonal' },
      { order: ['card-a', 'card-a'] },
    ] as Array<Record<string, unknown>>) {
      const theme = createDefaultTheme(BASE);
      theme.layout?.containers.push({
        id: 'grid',
        target: 'desktop-windows',
        screenId: 'library',
        format: 'landscape',
        nodeId: 'card-grid',
        order: ['card-a'],
        ...container,
      } as unknown as LayoutContainer);
      expect(() => parseThemeDocument(theme), JSON.stringify(container)).toThrow(DesignValidationError);
    }
  });

  it('accepts and validates the captured size basis on placements', () => {
    const theme = createDefaultTheme(BASE);
    theme.layout?.placements.push(placement({ basisWidth: 400, basisHeight: 300 }));
    const parsed = parseThemeDocument(theme);
    expect(parsed.layout?.placements[0]).toMatchObject({ basisWidth: 400, basisHeight: 300 });

    for (const patch of [
      { basisWidth: 10001 },
      { basisWidth: -1 },
      { basisHeight: 12.5 },
      { basisHeight: 'auto' },
    ] as Array<Partial<LayoutPlacement>>) {
      const invalid = createDefaultTheme(BASE);
      invalid.layout?.placements.push({ ...placement(), ...patch } as LayoutPlacement);
      expect(() => parseThemeDocument(invalid), JSON.stringify(patch)).toThrow(DesignValidationError);
    }
  });

  it('rejects duplicate placement ids, identities and unknown layout fields', () => {
    const theme = createDefaultTheme(BASE);
    theme.layout?.placements.push(placement(), placement({ id: 'other-id' }));
    expect(() => parseThemeDocument(theme)).toThrow(DesignValidationError);

    const duplicateIdentity = createDefaultTheme(BASE);
    duplicateIdentity.layout?.placements.push(placement(), placement({ id: 'other-id', label: 'Copy' }));
    expect(() => parseThemeDocument(duplicateIdentity)).toThrow(DesignValidationError);

    const unknownField = createDefaultTheme(BASE) as unknown as Record<string, unknown>;
    unknownField.layout = { containers: [], placements: [], extra: true };
    expect(() => parseThemeDocument(unknownField)).toThrow(DesignValidationError);

    const rawPlacement = createDefaultTheme(BASE) as unknown as { layout: { placements: Array<Record<string, unknown>> } };
    rawPlacement.layout.placements.push({ ...placement(), rotation: 45 } as never);
    expect(() => parseThemeDocument(rawPlacement)).toThrow(DesignValidationError);
  });

  it('rejects style presets with unknown tokens, duplicates or extra fields', () => {
    const theme = createDefaultTheme(BASE);
    theme.stylePresets = [
      { id: 'bad-token', name: 'Bad', tokens: { '--unknown': '#111111' } as never },
    ];
    expect(() => parseThemeDocument(theme)).toThrow(DesignValidationError);

    theme.stylePresets = [
      { id: 'same', name: 'One', tokens: { '--omp-color-accent': '#111111' } },
      { id: 'same', name: 'Two', tokens: { '--omp-color-accent': '#222222' } },
    ];
    expect(() => parseThemeDocument(theme)).toThrow(DesignValidationError);

    theme.stylePresets = [{ id: 'extra', name: 'Extra', tokens: {}, effect: 'glow' } as never];
    expect(() => parseThemeDocument(theme)).toThrow(DesignValidationError);
  });
});
