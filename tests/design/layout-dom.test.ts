import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultTheme } from '../../design/defaults';
import { collectLayoutNodes, observeLayout } from '../../design/layoutDom';
import { upsertLayoutPlacement, type LayoutContext, type LayoutPlacement } from '../../design/layout';
import { parseThemeDocument } from '../../design/validation';

const BASE = '0000000000000000000000000000000000000000';
const context: LayoutContext = { target: 'android-phone', screenId: 'library', format: 'landscape' };

function placement(nodeId: string, patch: Partial<LayoutPlacement> = {}): LayoutPlacement {
  return {
    id: `placement-${nodeId}`,
    target: context.target,
    screenId: context.screenId,
    format: context.format,
    nodeId,
    mode: 'flow',
    x: 0,
    y: 0,
    anchor: 'top-left',
    width: 'auto',
    height: 'auto',
    zIndex: 0,
    hidden: false,
    locked: false,
    label: nodeId,
    ...patch,
  };
}

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = '';
});

describe('layout dom runtime', () => {
  it('restores layout by data key after a dynamic item remount', async () => {
    const root = mount(`
      <div data-design-id="card-grid">
        <div class="m-card" data-key="hash-1" data-design-id="card">A</div>
        <div class="m-card" data-key="hash-2" data-design-id="card">B</div>
      </div>`);
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'absolute', x: 40, y: 24 }));

    cleanup = observeLayout(root, theme, context);
    const first = root.querySelector<HTMLElement>('[data-key="hash-1"]')!;
    expect(first.style.position).toBe('absolute');
    expect(first.style.left).toBe('0.4%');
    expect(first.style.top).toBe('0.24%');

    first.remove();
    await Promise.resolve();
    expect(root.querySelector('[data-key="hash-1"]')).toBeNull();

    const remounted = document.createElement('div');
    remounted.className = 'm-card';
    remounted.dataset.key = 'hash-1';
    remounted.dataset.designId = 'card';
    root.querySelector('[data-key="hash-2"]')!.after(remounted);
    await Promise.resolve();

    expect(root.querySelector('[data-key="hash-1"]')).not.toBeNull();
    expect(remounted.style.position).toBe('absolute');
    expect(remounted.style.left).toBe('0.4%');
    expect(remounted.style.top).toBe('0.24%');
  });

  it('throws on duplicate data keys instead of falling back to an index', () => {
    const root = mount(`
      <div data-design-id="card-grid">
        <div data-key="hash-1" data-design-id="card">A</div>
        <div data-key="hash-1" data-design-id="card">B</div>
      </div>`);
    const theme = createDefaultTheme(BASE);

    expect(() => observeLayout(root, theme, context)).toThrow(/duplicate data key/);
  });

  it('prefers the source data key over the registered adapter key', () => {
    const root = mount('<div data-design-id="toolbar"><div data-key="hash-1" data-design-id="card">A</div></div>');
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'absolute', x: 40, y: 24 }));
    theme = upsertLayoutPlacement(theme, placement('card', { mode: 'absolute', x: 99, y: 99 }));

    cleanup = observeLayout(root, theme, context);

    const item = root.querySelector<HTMLElement>('[data-key="hash-1"]')!;
    expect(item.style.left).toBe('0.4%');
    expect(item.style.top).toBe('0.24%');
    const nodes = collectLayoutNodes(root);
    expect(nodes.map((node) => node.nodeId)).toContain('key-hash-1');
    expect(nodes.find((node) => node.nodeId === 'key-hash-1')!.elementId).toBe('card');
  });

  it('resolves registered adapter keys and deterministic paths for static elements', () => {
    const root = mount('<div data-design-id="toolbar"><button data-design-id="button">Go</button><span>Caption</span></div>');

    const nodes = collectLayoutNodes(root);

    const rootNode = nodes.find((node) => node.nodeId === 'path-root')!;
    expect(rootNode.parentId).toBeNull();
    const toolbar = nodes.find((node) => node.nodeId === 'toolbar')!;
    expect(toolbar.kind).toBe('element');
    expect(toolbar.parentId).toBe('path-root');
    const button = nodes.find((node) => node.nodeId === 'button')!;
    expect(button.parentId).toBe('toolbar');
    expect(button.label).toBe('Go');
    const caption = nodes.find((node) => node.label === 'Caption')!;
    expect(caption.nodeId).toBe('path-0-1');
    expect(caption.parentId).toBe('toolbar');
  });

  it('disambiguates repeated adapter keys in document order', () => {
    const root = mount('<div><button data-design-id="button">One</button><button data-design-id="button">Two</button></div>');

    const nodes = collectLayoutNodes(root);
    const ids = nodes.filter((node) => node.elementId === 'button').map((node) => node.nodeId);

    expect(ids).toEqual(['button', 'button-2']);
  });

  it('round-trips every identity class through theme validation', () => {
    const root = mount(`
      <div data-design-id="toolbar">
        <button data-design-id="button">One</button>
        <button data-design-id="button">Two</button>
        <span>Caption</span>
        <div data-design-id="badge">N</div>
        <div data-key="hash-1">A</div>
        <div data-key="Длинный Ключ Ω">B</div>
        <div data-key="${'a'.repeat(80)}">C</div>
      </div>`);

    const nodes = collectLayoutNodes(root);
    const nodeIds = nodes.map((node) => node.nodeId);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    for (const nodeId of nodeIds) expect(nodeId).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);

    let theme = createDefaultTheme(BASE);
    for (const node of nodes) theme = upsertLayoutPlacement(theme, placement(node.nodeId, { label: node.nodeId }));
    const layout = theme.layout!;
    layout.containers.push({
      id: 'flow-toolbar',
      target: context.target,
      screenId: context.screenId,
      format: context.format,
      nodeId: 'toolbar',
      order: nodeIds,
    });

    expect(() => parseThemeDocument(theme)).not.toThrow();
    expect(parseThemeDocument(theme)).toEqual(theme);
    expect(() => parseThemeDocument(structuredClone(theme))).not.toThrow();
  });

  it('keeps safe data keys literal and hashes unsafe or long ones deterministically', () => {
    const root = mount(`
      <div>
        <div data-key="hash-1">A</div>
        <div data-key="${'b'.repeat(60)}">B</div>
        <div data-key="${'c'.repeat(61)}">C</div>
        <div data-key="HASH-1">D</div>
        <div data-key="Ключ Ω">E</div>
      </div>`);

    const nodes = collectLayoutNodes(root);
    const nodeIdOf = (key: string) => nodes.find((node) => node.kind === 'dynamic' && node.label === key)!.nodeId;

    expect(nodeIdOf('A')).toBe('key-hash-1');
    expect(nodeIdOf('B')).toBe(`key-${'b'.repeat(60)}`);
    const longId = nodeIdOf('C');
    const upperId = nodeIdOf('D');
    const unicodeId = nodeIdOf('E');
    for (const nodeId of [longId, upperId, unicodeId]) {
      expect(nodeId).toMatch(/^keyh-[a-z0-9-]{0,63}$/);
      expect(nodeId).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
    }
    expect(new Set([longId, upperId, unicodeId]).size).toBe(3);
    expect(nodeIdOf('E')).toBe(unicodeId);

    const again = collectLayoutNodes(root);
    const againId = again.find((node) => node.kind === 'dynamic' && node.label === 'E')!.nodeId;
    expect(againId).toBe(unicodeId);
  });

  it('marks dynamic items and keeps them addressable by data key', () => {
    const root = mount('<div data-design-id="toolbar"><div class="m-card" data-key="hash-1">A</div></div>');

    const nodes = collectLayoutNodes(root);
    const item = nodes.find((node) => node.nodeId === 'key-hash-1')!;

    expect(item.kind).toBe('dynamic');
    expect(item.elementId).toBe('key-hash-1');
    expect(item.parentId).toBe('toolbar');
  });

  it('applies absolute placement geometry, size and zIndex', () => {
    const root = mount('<div data-design-id="toolbar"><div data-design-id="badge">N</div></div>');
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('badge', {
      mode: 'absolute',
      x: 1000,
      y: 500,
      width: 2500,
      height: 1000,
      zIndex: 7,
    }));

    cleanup = observeLayout(root, theme, context);

    const badge = root.querySelector<HTMLElement>('[data-design-id="badge"]')!;
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.left).toBe('10%');
    expect(badge.style.top).toBe('5%');
    expect(badge.style.width).toBe('25%');
    expect(badge.style.height).toBe('10%');
    expect(badge.style.zIndex).toBe('7');
  });

  it('honors the placement anchor', () => {
    const root = mount('<div data-design-id="toolbar"><div data-design-id="badge">N</div></div>');
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('badge', { mode: 'absolute', x: 40, y: 24, anchor: 'bottom-right' }));

    cleanup = observeLayout(root, theme, context);

    const badge = root.querySelector<HTMLElement>('[data-design-id="badge"]')!;
    expect(badge.style.right).toBe('0.4%');
    expect(badge.style.bottom).toBe('0.24%');
    expect(badge.style.left).toBe('');
  });

  it('applies hidden placements and skips locked ones in the editor runtime', () => {
    const root = mount('<div data-design-id="toolbar"><div data-design-id="badge">N</div><div data-design-id="hint">H</div></div>');
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('badge', { mode: 'absolute', x: 40, y: 24, locked: true }));
    theme = upsertLayoutPlacement(theme, placement('hint', { hidden: true }));

    cleanup = observeLayout(root, theme, context);

    const badge = root.querySelector<HTMLElement>('[data-design-id="badge"]')!;
    expect(badge.style.position).toBe('');
    const hint = root.querySelector<HTMLElement>('[data-design-id="hint"]')!;
    expect(hint.style.display).toBe('none');
  });

  it('keeps missing nodes in the document order', async () => {
    const root = mount(`
      <div data-design-id="card-grid">
        <div data-key="hash-1" data-design-id="card">A</div>
        <div data-key="hash-2" data-design-id="card">B</div>
      </div>`);
    let theme = createDefaultTheme(BASE);
    theme.layout = {
      containers: [{
        id: 'flow-card-grid',
        target: context.target,
        screenId: context.screenId,
        format: context.format,
        nodeId: 'card-grid',
        order: ['key-hash-1', 'key-hash-3', 'key-hash-2'],
      }],
      placements: [],
    };
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);
    const order = () => [...root.querySelectorAll('[data-key]')].map((element) => element.getAttribute('data-key'));
    expect(order()).toEqual(['hash-1', 'hash-2']);

    const late = document.createElement('div');
    late.dataset.key = 'hash-3';
    late.dataset.designId = 'card';
    root.querySelector('[data-design-id="card-grid"]')!.appendChild(late);
    await Promise.resolve();

    expect(order()).toEqual(['hash-1', 'hash-3', 'hash-2']);
  });

  it('only touches nodes of the matching context', () => {
    const root = mount('<div data-design-id="toolbar"><div data-design-id="badge">N</div></div>');
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('badge', { mode: 'absolute', x: 40, y: 24, format: 'portrait' }));

    cleanup = observeLayout(root, theme, context);

    expect(root.querySelector<HTMLElement>('[data-design-id="badge"]')!.style.position).toBe('');
  });
});
