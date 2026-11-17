import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowDocument, FlowEdge, FlowGraph, FlowNodeView } from '../../design/schema';
import { SimulationPanel } from '../../editor/src/components/SimulationPanel';
import type { DesktopDesignTarget } from '../../design/schema';

const BASE = '0000000000000000000000000000000000000000';

function node(id: string, kind: FlowNodeView['kind'], stepId?: string, label?: string): FlowNodeView {
  return { id, kind, stepId, x: 0, y: 0, ...(label ? { label } : {}) };
}

function edge(id: string, from: string, to: string, branch: FlowEdge['branch'] = 'default'): FlowEdge {
  return { id, from, to, branch };
}

function debugFlow(): FlowDocument {
  const graph: FlowGraph = {
    nodes: [
      node('t', 'trigger', undefined, 'Старт'),
      node('c', 'condition', 's-c', 'Сервер?'),
      node('a', 'action', 's-a', 'Запомнить'),
      node('r', 'result', 's-r', 'Экран подключения'),
    ],
    edges: [edge('e1', 't', 'c'), edge('e2', 'c', 'a', 'true'), edge('e3', 'c', 'r', 'false')],
  };
  return {
    schemaVersion: 1,
    id: 'debug-flow',
    baseCommit: BASE,
    variables: [{ id: 'v1', name: 'Retries', type: 'number', initial: 0 }],
    rules: [{
      id: 'rule-1',
      screenId: 'settings',
      elementId: 'settings-continue',
      event: 'click',
      action: { type: 'toast', message: 'unused legacy action' },
      graph,
      steps: [
        { id: 's-c', condition: { kind: 'eq', path: 'server.connected', value: true } },
        { id: 's-a', action: { type: 'variable.set', variableId: 'v1', value: 1 } },
        { id: 's-r', action: { type: 'navigate', screenId: 'connect' } },
      ],
    }],
  };
}

let host: HTMLDivElement;

function mount(props: Partial<Parameters<typeof SimulationPanel>[0]> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  renderPanel(props);
}

function renderPanel(props: Partial<Parameters<typeof SimulationPanel>[0]>) {
  act(() => render(h(SimulationPanel, {
    target: 'desktop-windows' as DesktopDesignTarget,
    flow: debugFlow(),
    serverConnected: false,
    onServerConnected: () => undefined,
    route: 'settings',
    orientation: 'landscape',
    ...props,
  }), host));
}

function click(selector: string): void {
  act(() => {
    host.querySelector<HTMLElement>(selector)!.click();
  });
}

function toggle(checkbox: HTMLInputElement, checked: boolean): void {
  act(() => {
    checkbox.checked = checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

afterEach(() => {
  host.remove();
});

describe('FlowDebugger panel', () => {
  it('renders debugger controls and mock toggles', () => {
    mount();
    for (const action of ['debug-start', 'debug-pause', 'debug-step-over', 'debug-step-into', 'debug-stop', 'debug-reset', 'debug-compare']) {
      expect(host.querySelector(`[data-action="${action}"]`)).not.toBeNull();
    }
    expect(host.querySelector('[data-testid="mock-server"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mock-network"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mock-account"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mock-playback"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mock-download"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="debug-rule"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="debug-bp-rule"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="debug-bp-c"]')).not.toBeNull();
  });

  it('start runs to completion and shows trace and variables', () => {
    mount();
    toggle(host.querySelector<HTMLInputElement>('[data-testid="mock-server"]')!, true);
    click('[data-action="debug-start"]');
    expect(host.querySelector('[data-testid="debug-status"]')!.textContent).toContain('completed');
    expect(host.querySelectorAll('[data-testid="debug-trace-entry"]')).toHaveLength(2);
    const variable = host.querySelector('[data-testid="debug-variable"]');
    expect(variable).not.toBeNull();
    expect(variable!.textContent).toContain('Retries');
    expect(variable!.textContent).toContain('1');
  });

  it('a node breakpoint pauses the run and shows the current node', () => {
    mount();
    toggle(host.querySelector<HTMLInputElement>('[data-testid="mock-server"]')!, true);
    toggle(host.querySelector<HTMLInputElement>('[data-testid="debug-bp-a"]')!, true);
    click('[data-action="debug-start"]');
    expect(host.querySelector('[data-testid="debug-status"]')!.textContent).toContain('paused');
    expect(host.querySelector('[data-testid="debug-current-node"]')!.textContent).toContain('Запомнить');
    click('[data-action="debug-start"]');
    expect(host.querySelector('[data-testid="debug-status"]')!.textContent).toContain('completed');
  });

  it('step into advances one node at a time', () => {
    mount();
    click('[data-action="debug-step-into"]');
    expect(host.querySelector('[data-testid="debug-status"]')!.textContent).toContain('paused');
    expect(host.querySelector('[data-testid="debug-current-node"]')!.textContent).toContain('Старт');
    click('[data-action="debug-step-into"]');
    expect(host.querySelector('[data-testid="debug-current-node"]')!.textContent).toContain('Сервер?');
    expect(host.querySelectorAll('[data-testid="debug-trace-entry"]')).toHaveLength(1);
  });

  it('mock toggles never touch the editor settings', () => {
    const onServerConnected = vi.fn();
    mount({ onServerConnected });
    toggle(host.querySelector<HTMLInputElement>('[data-testid="mock-server"]')!, true);
    toggle(host.querySelector<HTMLInputElement>('[data-testid="mock-network"]')!, false);
    expect(onServerConnected).not.toHaveBeenCalled();
  });

  it('changing route resets the debug session', () => {
    mount();
    toggle(host.querySelector<HTMLInputElement>('[data-testid="mock-server"]')!, true);
    click('[data-action="debug-start"]');
    expect(host.querySelectorAll('[data-testid="debug-trace-entry"]')).toHaveLength(2);
    renderPanel({ route: 'library' });
    expect(host.querySelector('[data-testid="debug-empty"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="debug-trace-entry"]')).toHaveLength(0);
  });

  it('changing orientation resets the debug session', () => {
    mount();
    toggle(host.querySelector<HTMLInputElement>('[data-testid="mock-server"]')!, true);
    click('[data-action="debug-start"]');
    expect(host.querySelectorAll('[data-testid="debug-trace-entry"]')).toHaveLength(2);
    renderPanel({ orientation: 'portrait' });
    expect(host.querySelector('[data-testid="debug-status"]')!.textContent).toContain('idle');
    expect(host.querySelectorAll('[data-testid="debug-trace-entry"]')).toHaveLength(0);
  });

  it('rerun and compare highlights the first trace difference', () => {
    mount();
    toggle(host.querySelector<HTMLInputElement>('[data-testid="mock-server"]')!, true);
    click('[data-action="debug-start"]');
    expect(host.querySelectorAll('[data-testid="debug-trace-entry"]')).toHaveLength(2);
    toggle(host.querySelector<HTMLInputElement>('[data-testid="mock-server"]')!, false);
    click('[data-action="debug-compare"]');
    const diff = host.querySelector('[data-testid="debug-trace-diff"]')!.textContent!;
    expect(diff).toContain('1');
    expect(diff).toContain('true');
    expect(diff).toContain('false');
  });
});
