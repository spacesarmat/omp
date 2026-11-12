import { describe, expect, it } from 'vitest';
import { createDefaultFlow, createDefaultTheme } from '../../design/defaults';
import type { FlowDocument, FlowVariable, InteractionCondition, InteractionRule, LayoutContainer, LayoutPlacement } from '../../design/schema';
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

describe('flow graph schema', () => {
  const graphFlow = (): FlowDocument => ({
    schemaVersion: 1,
    id: 'graph-flow',
    baseCommit: BASE,
    variables: [
      { id: 'server-name', name: 'Server', type: 'string', initial: 'omp' },
      { id: 'retries', name: 'Retries', type: 'number', initial: 0 },
      { id: 'active', name: 'Active', type: 'boolean', initial: false },
      { id: 'mode', name: 'Mode', type: 'enum', initial: 'a', values: ['a', 'b'] },
    ],
    rules: [
      {
        id: 'enter-library',
        screenId: 'library',
        elementId: 'library-root',
        event: 'screen.enter',
        condition: { kind: 'gte', path: 'variable.retries', value: 0 },
        steps: [
          { id: 'check', condition: { kind: 'exists', path: 'network.online' } },
          { id: 'mark', action: { type: 'variable.set', variableId: 'active', value: true } },
          { id: 'notify', action: { type: 'dialog', title: 'Hi', message: 'There' } },
        ],
        action: { type: 'navigate', screenId: 'library' },
        graph: {
          nodes: [
            { id: 't', kind: 'trigger', ruleId: 'enter-library', x: 0, y: 0 },
            { id: 'c', kind: 'condition', stepId: 'check', x: 160, y: 0, label: 'Online' },
            { id: 'r', kind: 'result', stepId: 'mark', x: 320, y: 0 },
          ],
          edges: [
            { id: 'e1', from: 't', to: 'c', branch: 'default' },
            { id: 'e2', from: 'c', to: 'r', branch: 'true' },
          ],
        },
        cooldownMs: 500,
      },
    ],
  });

  it('accepts graph rules, typed variables and new events', () => {
    expect(parseFlowDocument(graphFlow())).toEqual(graphFlow());
  });

  it('keeps legacy documents without graph unchanged', () => {
    expect(parseFlowDocument(createDefaultFlow(BASE))).toEqual(createDefaultFlow(BASE));
  });

  it('keeps legacy rule order in a mixed document', () => {
    const flow = createDefaultFlow(BASE);
    const graphDoc = graphFlow();
    flow.variables = graphDoc.variables;
    flow.rules.push(graphDoc.rules[0]);
    flow.rules.unshift({ id: 'first', screenId: '*', elementId: 'top', event: 'click', action: { type: 'back' } });
    const parsed = parseFlowDocument(flow);
    expect(parsed.rules.map((rule) => rule.id)).toEqual(['first', ...createDefaultFlow(BASE).rules.map((rule) => rule.id), 'enter-library']);
  });

  it('rejects variables whose initial value does not match the type', () => {
    const reject = (variable: FlowVariable) => {
      const flow = graphFlow();
      flow.variables = [variable];
      expect(() => parseFlowDocument(flow), JSON.stringify(variable)).toThrow(DesignValidationError);
    };
    reject({ id: 'v', name: 'V', type: 'number', initial: '0' });
    reject({ id: 'v', name: 'V', type: 'boolean', initial: 1 });
    reject({ id: 'v', name: 'V', type: 'string', initial: true });
    reject({ id: 'v', name: 'V', type: 'enum', initial: 'c', values: ['a', 'b'] });
    reject({ id: 'v', name: 'V', type: 'enum', initial: 'a' });
    reject({ id: 'v', name: 'V', type: 'enum', initial: 'a', values: [] });
    reject({ id: 'v', name: 'V', type: 'number', initial: 0, values: ['a'] } as never);
  });

  it('rejects duplicate variable ids', () => {
    const flow = graphFlow();
    flow.variables = [
      { id: 'same', name: 'One', type: 'boolean', initial: false },
      { id: 'same', name: 'Two', type: 'boolean', initial: true },
    ];
    expect(() => parseFlowDocument(flow)).toThrow(DesignValidationError);
  });

  it('rejects variable.set and condition paths against unknown variables', () => {
    const unknownSet = graphFlow();
    (unknownSet.rules[0].steps![1].action as { variableId: string }).variableId = 'missing';
    expect(() => parseFlowDocument(unknownSet)).toThrow(DesignValidationError);

    const wrongType = graphFlow();
    (wrongType.rules[0].steps![1].action as { value: unknown }).value = 'not-a-boolean';
    expect(() => parseFlowDocument(wrongType)).toThrow(DesignValidationError);

    const unknownPath = graphFlow();
    unknownPath.rules[0].condition = { kind: 'eq', path: 'variable.missing', value: 1 };
    expect(() => parseFlowDocument(unknownPath)).toThrow(DesignValidationError);
  });

  it('rejects executable actions, arbitrary paths and network access', () => {
    const mutate = (patch: (rule: InteractionRule) => void) => {
      const flow = graphFlow();
      patch(flow.rules[0]);
      return flow;
    };
    expect(() => parseFlowDocument(mutate((rule) => {
      rule.steps = [{ id: 'x', action: { type: 'eval', code: 'alert(1)' } as never }];
    }))).toThrow(DesignValidationError);
    expect(() => parseFlowDocument(mutate((rule) => {
      rule.steps = [{ id: 'x', action: { type: 'fetch', url: 'https://evil.example.com' } as never }];
    }))).toThrow(DesignValidationError);
    expect(() => parseFlowDocument(mutate((rule) => {
      rule.steps = [{ id: 'x', action: { type: 'variable.set', variableId: 'active', value: { injected: true } } as never }];
    }))).toThrow(DesignValidationError);
    expect(() => parseFlowDocument(mutate((rule) => {
      rule.condition = { kind: 'eq', path: 'window.location' as never, value: true };
    }))).toThrow(DesignValidationError);
    expect(() => parseFlowDocument(mutate((rule) => {
      rule.steps = [{ id: 'x', action: { type: 'link.open', url: 'http://t.me/omp' } }];
    }))).toThrow(DesignValidationError);
    expect(() => parseFlowDocument(mutate((rule) => {
      rule.steps = [{ id: 'x', action: { type: 'link.open', url: 'https://evil.example.com/x' } }];
    }))).toThrow(DesignValidationError);
    expect(() => parseFlowDocument(mutate((rule) => {
      rule.steps = [{ id: 'x', action: { type: 'telegram.open', target: 'random-chat' } }];
    }))).toThrow(DesignValidationError);
    const allowed = mutate((rule) => {
      rule.steps = [
        ...(rule.steps ?? []),
        { id: 'x', action: { type: 'link.open', url: 'https://t.me/ompplyaer' } },
        { id: 'y', action: { type: 'telegram.open', target: 'channel' } },
      ];
    });
    expect(() => parseFlowDocument(allowed)).not.toThrow();
  });

  it('rejects condition values that do not match the operator', () => {
    const mutate = (condition: InteractionCondition) => {
      const flow = graphFlow();
      flow.rules[0].condition = condition;
      return flow;
    };
    expect(() => parseFlowDocument(mutate({ kind: 'gt', path: 'variable.retries', value: '10' }))).toThrow(DesignValidationError);
    expect(() => parseFlowDocument(mutate({ kind: 'contains', path: 'server-name' as never, value: 5 }))).toThrow(DesignValidationError);
    expect(() => parseFlowDocument(mutate({ kind: 'eq', path: 'server.connected' } as never))).toThrow(DesignValidationError);
    expect(() => parseFlowDocument(mutate({ kind: 'exists', path: 'network.online', value: true } as never))).toThrow(DesignValidationError);
  });

  it('rejects malformed graphs and steps', () => {
    const mutate = (patch: (rule: InteractionRule) => void) => {
      const flow = graphFlow();
      patch(flow.rules[0]);
      expect(() => parseFlowDocument(flow)).toThrow(DesignValidationError);
    };
    mutate((rule) => {
      rule.graph = { nodes: [{ id: 't', kind: 'trigger', x: 0, y: 0 }], edges: [{ id: 'e', from: 't', to: 't', branch: 'default' }] };
    });
    mutate((rule) => {
      rule.graph = { nodes: [{ id: 't', kind: 'trigger', x: 0, y: 0 }], edges: [{ id: 'e', from: 't', to: 'missing', branch: 'default' }] };
    });
    mutate((rule) => {
      rule.graph = {
        nodes: [{ id: 't', kind: 'trigger', x: 0, y: 0 }, { id: 't', kind: 'action', x: 1, y: 0 }],
        edges: [],
      };
    });
    mutate((rule) => {
      rule.graph = { nodes: [{ id: 't', kind: 'delay' as never, x: 0, y: 0 }], edges: [] };
    });
    mutate((rule) => {
      rule.graph = {
        nodes: [{ id: 't', kind: 'trigger', x: 0, y: 0 }, { id: 'a', kind: 'action', x: 1, y: 0 }],
        edges: [{ id: 'e', from: 't', to: 'a', branch: 'maybe' as never }],
      };
    });
    mutate((rule) => {
      rule.graph = { nodes: [{ id: 't', kind: 'trigger', x: -1, y: 0 }], edges: [] };
    });
    mutate((rule) => {
      rule.graph = { nodes: [{ id: 't', kind: 'trigger', ruleId: 'other-rule', x: 0, y: 0 }], edges: [] };
    });
    mutate((rule) => {
      rule.steps = [{ id: 'same', action: { type: 'back' } }, { id: 'same', action: { type: 'back' } }];
    });
    mutate((rule) => {
      rule.steps = [{ id: 'empty' }];
    });
    mutate((rule) => {
      delete (rule as { action?: InteractionRule['action'] }).action;
    });
    mutate((rule) => {
      rule.cooldownMs = -1;
    });
    mutate((rule) => {
      rule.cooldownMs = 1.5;
    });
  });
});
