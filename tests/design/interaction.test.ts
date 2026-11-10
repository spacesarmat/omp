import { describe, expect, it } from 'vitest';
import { createDefaultFlow } from '../../design/defaults';
import { dispatchInteraction, type InteractionDispatcher } from '../../design/interaction';
import { validateFlow } from '../../design/flow-validation';
import { parseFlowDocument } from '../../design/validation';
import type { FlowDocument, InteractionCondition } from '../../design/schema';

const BASE = '0000000000000000000000000000000000000000';
const ROUTES = ['library', 'news', 'search', 'remote', 'settings', 'connect'];
const event = { screenId: 'settings', elementId: 'settings-continue', type: 'click' as const };

function dispatcher(calls: string[]): InteractionDispatcher {
  return {
    navigate: (id) => calls.push(id),
    back: () => calls.push('back'),
    toast: (message) => calls.push(message),
  };
}

describe('interaction interpreter', () => {
  it('routes a disconnected server to connect with one action', () => {
    const calls: string[] = [];
    const trace = dispatchInteraction(createDefaultFlow(BASE), event, { target: 'desktop-windows', screenId: 'settings', serverConnected: false }, dispatcher(calls));
    expect(calls).toEqual(['connect']);
    expect(trace[trace.length - 1]).toMatchObject({ action: 'navigate', target: 'connect' });
  });

  it('routes a connected server to library without entering connect', () => {
    const calls: string[] = [];
    dispatchInteraction(createDefaultFlow(BASE), event, { target: 'desktop-windows', screenId: 'settings', serverConnected: true }, dispatcher(calls));
    expect(calls).toEqual(['library']);
  });

  it('supports wildcard navigation rules without automatic follow-up actions', () => {
    const calls: string[] = [];
    const flow = createDefaultFlow(BASE);
    flow.rules.push({ id: 'library-back', screenId: 'library', elementId: 'nav-library', event: 'click', action: { type: 'back' } });
    dispatchInteraction(flow, { screenId: 'settings', elementId: 'nav-library', type: 'click' }, { target: 'desktop-windows', screenId: 'settings', serverConnected: false }, dispatcher(calls));
    expect(calls).toEqual(['library']);
  });

  it('emits one back or toast action per event', () => {
    const calls: string[] = [];
    const flow = createDefaultFlow(BASE);
    flow.rules.unshift({ id: 'back', screenId: 'settings', elementId: 'settings-continue', event: 'click', action: { type: 'back' } });
    flow.rules.unshift({ id: 'toast', screenId: 'settings', elementId: 'settings-continue', event: 'click', condition: { kind: 'eq', path: 'target', value: 'desktop-macos' }, action: { type: 'toast', message: 'hello' } });
    const target = { screenId: 'settings', serverConnected: true } as const;
    dispatchInteraction(flow, event, { ...target, target: 'desktop-windows' }, dispatcher(calls));
    dispatchInteraction(flow, event, { ...target, target: 'desktop-macos' }, dispatcher(calls));
    expect(calls).toEqual(['back', 'hello']);
  });
});

describe('flow validation', () => {
  it('accepts default routes', () => {
    expect(validateFlow(createDefaultFlow(BASE), ROUTES)).toEqual([]);
  });

  it('reports rules shadowed by an unconditional rule', () => {
    const flow = createDefaultFlow(BASE);
    flow.rules.unshift({ id: 'catch-all', screenId: 'settings', elementId: 'settings-continue', event: 'click', action: { type: 'back' } });
    expect(validateFlow(flow, ROUTES)).toContainEqual(expect.objectContaining({ code: 'SHADOWED_RULE' }));
  });

  it('reports an unknown destination and duplicate ids', () => {
    const flow: FlowDocument = {
      ...createDefaultFlow(BASE),
      rules: [
        { id: 'duplicate', screenId: 'settings', elementId: 'one', event: 'click', action: { type: 'navigate', screenId: 'missing' } },
        { id: 'duplicate', screenId: 'settings', elementId: 'two', event: 'click', action: { type: 'back' } },
      ],
    };
    expect(validateFlow(flow, ROUTES)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNKNOWN_ROUTE' }),
      expect.objectContaining({ code: 'DUPLICATE_RULE' }),
    ]));
  });

  it('rejects executable actions, arbitrary paths and deep conditions', () => {
    expect(() => parseFlowDocument({ ...createDefaultFlow(BASE), rules: [{ id: 'x', screenId: 'settings', elementId: 'x', event: 'click', action: { type: 'eval' } }] })).toThrow();
    expect(() => parseFlowDocument({ ...createDefaultFlow(BASE), rules: [{ id: 'x', screenId: 'settings', elementId: 'x', event: 'click', condition: { kind: 'eq', path: 'window.location' as never, value: true }, action: { type: 'back' } }] })).toThrow();
    let nested: InteractionCondition = { kind: 'eq', path: 'server.connected', value: true };
    for (let index = 0; index < 10; index += 1) nested = { kind: 'not', condition: nested };
    expect(() => parseFlowDocument({ ...createDefaultFlow(BASE), rules: [{ id: 'deep', screenId: 'settings', elementId: 'x', event: 'click', condition: nested, action: { type: 'back' } }] })).toThrow();
  });
});
