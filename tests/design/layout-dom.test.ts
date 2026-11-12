import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('applies hidden and locked placements in the editor runtime: locks only gate edits', () => {
    const root = mount('<div data-design-id="toolbar"><div data-design-id="badge">N</div><div data-design-id="hint">H</div></div>');
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('badge', { mode: 'absolute', x: 40, y: 24, locked: true }));
    theme = upsertLayoutPlacement(theme, placement('hint', { hidden: true }));

    cleanup = observeLayout(root, theme, context);

    const badge = root.querySelector<HTMLElement>('[data-design-id="badge"]')!;
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.left).toBe('0.4%');
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

  it('materializes a clone from sanitized html even when the source node is absent', () => {
    const root = mount('<div data-design-id="card-grid"><div data-key="hash-1" data-design-id="card">A</div></div>');
    let theme = createDefaultTheme(BASE);
    theme.layout = {
      containers: [],
      placements: [placement('copy-demo', { label: 'Copy' })],
      clones: [{
        id: 'clone-demo',
        target: context.target,
        screenId: context.screenId,
        format: context.format,
        nodeId: 'copy-demo',
        parentId: 'card-grid',
        label: 'Copy',
        sourceNodeId: 'key-hash-1',
        html: '<div class="m-card" data-design-id="card" data-key="hash-1" style="position:absolute"><script>alert(1)</script><span onclick="x()">Cloned</span></div>',
      }],
    };

    cleanup = observeLayout(root, theme, context);

    const clone = root.querySelector<HTMLElement>('[data-layout-clone="copy-demo"]')!;
    expect(clone).not.toBeNull();
    expect(clone.textContent).toBe('Cloned');
    expect(clone.querySelector('script')).toBeNull();
    expect(clone.getAttribute('data-key')).toBeNull();
    expect(clone.getAttribute('style')).toBeNull();
    expect(clone.getAttribute('onclick')).toBeNull();
    expect(clone.getAttribute('data-design-id')).toBe('card');
    const cloneNode = collectLayoutNodes(root).find((node) => node.nodeId === 'copy-demo')!;
    expect(cloneNode.elementId).toBe('card');
    expect(cloneNode.parentId).toBe('card-grid');
  });

  it('removes clone elements when their records leave the layout document', () => {
    const root = mount('<div data-design-id="card-grid"></div>');
    let theme = createDefaultTheme(BASE);
    theme.layout = {
      containers: [],
      placements: [],
      clones: [{
        id: 'clone-a',
        target: context.target,
        screenId: context.screenId,
        format: context.format,
        nodeId: 'copy-a',
        parentId: 'card-grid',
        label: 'Copy A',
        html: '<div data-design-id="card">A copy</div>',
      }],
    };
    cleanup = observeLayout(root, parseThemeDocument(theme), context);
    expect(root.querySelector('[data-layout-clone="copy-a"]')).not.toBeNull();

    cleanup();
    const empty = createDefaultTheme(BASE);
    empty.layout = { containers: [], placements: [] };
    cleanup = observeLayout(root, parseThemeDocument(empty), context);

    expect(root.querySelector('[data-layout-clone="copy-a"]')).toBeNull();
  });

  it('keeps duplicated clones independent with unique identities and geometry', () => {
    const root = mount('<div data-design-id="card-grid"></div>');
    let theme = createDefaultTheme(BASE);
    const html = '<div class="m-card" data-design-id="card">Card</div>';
    theme.layout = {
      containers: [],
      placements: [
        placement('copy-a', { label: 'Copy A', mode: 'absolute', x: 1000, y: 1000 }),
        placement('copy-b', { label: 'Copy B', mode: 'absolute', x: 5000, y: 5000 }),
      ],
      clones: [
        { id: 'clone-a', target: context.target, screenId: context.screenId, format: context.format, nodeId: 'copy-a', parentId: 'card-grid', label: 'Copy A', html },
        { id: 'clone-b', target: context.target, screenId: context.screenId, format: context.format, nodeId: 'copy-b', parentId: 'card-grid', label: 'Copy B', html },
      ],
    };
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);

    const first = root.querySelector<HTMLElement>('[data-layout-clone="copy-a"]')!;
    const second = root.querySelector<HTMLElement>('[data-layout-clone="copy-b"]')!;
    expect(first.style.left).toBe('10%');
    expect(second.style.left).toBe('50%');
    const nodeIds = collectLayoutNodes(root).map((node) => node.nodeId);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  it('round-trips clone records through theme validation and rejects unsafe ones', () => {
    let theme = createDefaultTheme(BASE);
    const validClone = {
      id: 'clone-a',
      target: context.target,
      screenId: context.screenId,
      format: context.format,
      nodeId: 'copy-a',
      parentId: 'card-grid',
      label: 'Copy A',
      sourceNodeId: 'card',
      html: '<div data-design-id="card">Copy</div>',
    };
    theme.layout = { containers: [], placements: [], clones: [validClone] };

    expect(parseThemeDocument(structuredClone(theme))).toEqual(theme);

    theme.layout.clones = [{ ...validClone, html: '<div><script>alert(1)</script></div>' }];
    expect(() => parseThemeDocument(theme)).toThrow(/html/);

    theme.layout.clones = [{ ...validClone, nodeId: 'Bad Id' }];
    expect(() => parseThemeDocument(theme)).toThrow();

    theme.layout.clones = [{ ...validClone }, { ...validClone, id: 'clone-b' }];
    expect(() => parseThemeDocument(theme)).toThrow(/duplicate/);
  });

  it('refuses to materialize clones whose root is a blocked tag', () => {
    const root = mount('<div data-design-id="card-grid"></div>');
    let theme = createDefaultTheme(BASE);
    theme.layout = {
      containers: [],
      placements: [],
      clones: [
        { id: 'clone-script', target: context.target, screenId: context.screenId, format: context.format, nodeId: 'copy-script', parentId: 'card-grid', label: 'Script', html: '<script>alert(1)</script>' },
        { id: 'clone-iframe', target: context.target, screenId: context.screenId, format: context.format, nodeId: 'copy-iframe', parentId: 'card-grid', label: 'Iframe', html: '<iframe src="https://evil.example"></iframe>' },
        { id: 'clone-slash', target: context.target, screenId: context.screenId, format: context.format, nodeId: 'copy-slash', parentId: 'card-grid', label: 'Slash', html: '<script/>alert(1)' },
      ],
    };

    cleanup = observeLayout(root, theme, context);

    expect(root.querySelector('[data-layout-clone="copy-script"]')).toBeNull();
    expect(root.querySelector('[data-layout-clone="copy-iframe"]')).toBeNull();
    expect(root.querySelector('[data-layout-clone="copy-slash"]')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('iframe')).toBeNull();
  });

  it('rejects crafted clone html with blocked root tags or slash script variants in validation', () => {
    let theme = createDefaultTheme(BASE);
    const baseClone = {
      id: 'clone-a',
      target: context.target,
      screenId: context.screenId,
      format: context.format,
      nodeId: 'copy-a',
      parentId: 'card-grid',
      label: 'Copy A',
      html: '<div data-design-id="card">Copy</div>',
    };
    theme.layout = { containers: [], placements: [], clones: [{ ...baseClone, html: '<script>alert(1)</script>' }] };
    expect(() => parseThemeDocument(theme)).toThrow(/html/);
    theme.layout.clones = [{ ...baseClone, html: '<script/>alert(1)' }];
    expect(() => parseThemeDocument(theme)).toThrow(/html/);
    theme.layout.clones = [{ ...baseClone, html: '<iframe src="https://evil.example"></iframe>' }];
    expect(() => parseThemeDocument(theme)).not.toThrow();
  });
});

describe('layout key hashing', () => {
  it('stays free of BigInt so legacy TV and webOS builds can parse the module', () => {
    const source = readFileSync(resolve(process.cwd(), 'design/layoutDom.ts'), 'utf8');
    expect(source).not.toContain('BigInt');
    expect(source).not.toMatch(/[0-9]n\b/);
  });

  it('hashes unsafe data keys to deterministic legacy-compatible ids', () => {
    const root = mount(`
      <div>
        <div data-key="HASH-1">A</div>
        <div data-key="Ключ Ω">B</div>
        <div data-key="${'c'.repeat(61)}">C</div>
      </div>`);

    const nodes = collectLayoutNodes(root);
    const nodeIdOf = (label: string) => nodes.find((node) => node.label === label)!.nodeId;

    expect(nodeIdOf('A')).toBe('keyh-cfd2b455e879087f');
    expect(nodeIdOf('B')).toBe('keyh-d957f271851c7596');
    expect(nodeIdOf('C')).toBe('keyh-9b26faeadf926e36');
    for (const node of nodes) {
      expect(node.nodeId).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      expect(node.nodeId.length).toBeLessThanOrEqual(64);
    }
  });
});

describe('layout identity stability', () => {
  it('keeps adapter identities and placements attached to their elements across repeated order swaps', async () => {
    const root = mount('<div data-design-id="toolbar"><button data-design-id="button">One</button><button data-design-id="button">Two</button></div>');
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('button', { mode: 'absolute', x: 1000, y: 1000 }));
    theme = upsertLayoutPlacement(theme, placement('button-2', { mode: 'absolute', x: 2000, y: 2000 }));
    theme.layout!.containers.push({ id: 'flow-toolbar', ...context, nodeId: 'toolbar', order: ['button', 'button-2'] });
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);
    const one = () => [...root.querySelectorAll('button')].find((button) => button.textContent === 'One') as HTMLElement;
    const two = () => [...root.querySelectorAll('button')].find((button) => button.textContent === 'Two') as HTMLElement;
    const texts = () => [...root.querySelectorAll('button')].map((button) => button.textContent);
    const nodeIdOf = (label: string) => collectLayoutNodes(root).find((node) => node.label === label)!.nodeId;

    expect(texts()).toEqual(['One', 'Two']);
    expect(one().style.left).toBe('10%');
    expect(two().style.left).toBe('20%');

    const swap = async (order: string[]) => {
      theme.layout!.containers = [{ id: 'flow-toolbar', ...context, nodeId: 'toolbar', order }];
      root.appendChild(document.createElement('span'));
      await Promise.resolve();
    };

    for (let round = 0; round < 3; round += 1) {
      await swap(['button-2', 'button']);
      expect(texts()).toEqual(['Two', 'One']);
      expect(nodeIdOf('One')).toBe('button');
      expect(nodeIdOf('Two')).toBe('button-2');
      expect(one().style.left).toBe('10%');
      expect(two().style.left).toBe('20%');

      await swap(['button', 'button-2']);
      expect(texts()).toEqual(['One', 'Two']);
      expect(nodeIdOf('One')).toBe('button');
      expect(nodeIdOf('Two')).toBe('button-2');
      expect(one().style.left).toBe('10%');
      expect(two().style.left).toBe('20%');
    }
  });
});

describe('layout style lifecycle', () => {
  it('restores original inline styles and document order when the first placement is undone', async () => {
    const root = mount('<div data-design-id="toolbar"><button data-design-id="button" style="position: relative; margin: 3px">One</button><button data-design-id="button">Two</button></div>');
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('button', { mode: 'absolute', x: 1000, y: 1000, hidden: true }));
    theme.layout!.containers.push({ id: 'flow-toolbar', ...context, nodeId: 'toolbar', order: ['button-2', 'button'] });
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);
    const one = () => [...root.querySelectorAll('button')].find((button) => button.textContent === 'One') as HTMLElement;
    const texts = () => [...root.querySelectorAll('button')].map((button) => button.textContent);
    expect(one().style.display).toBe('none');
    expect(one().style.position).toBe('absolute');
    expect(texts()).toEqual(['Two', 'One']);

    theme.layout = { containers: [], placements: [] };
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(one().style.display).toBe('');
    expect(one().style.position).toBe('relative');
    expect(one().style.margin).toBe('3px');
    expect(one().dataset.layoutManaged).toBeUndefined();
    expect(one().dataset.layoutHidden).toBeUndefined();
    expect(texts()).toEqual(['One', 'Two']);
  });

  it('restores flow-mode inline styles when an absolute placement switches back to flow', async () => {
    const root = mount('<div data-design-id="toolbar"><div data-design-id="badge" style="z-index: 4">N</div></div>');
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('badge', { mode: 'absolute', x: 40, y: 24 }));

    cleanup = observeLayout(root, theme, context);
    const badge = () => root.querySelector<HTMLElement>('[data-design-id="badge"]')!;
    expect(badge().style.position).toBe('absolute');
    expect(badge().style.zIndex).toBe('0');

    theme.layout = upsertLayoutPlacement(theme, placement('badge', { mode: 'flow', x: 0, y: 0 })).layout;
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(badge().style.position).toBe('');
    expect(badge().style.zIndex).toBe('4');
  });
});

describe('container layout styles', () => {
  it('applies margin and container direction, padding, alignment and distribution with cleanup on undo', async () => {
    const root = mount('<div data-design-id="panel"><div data-design-id="toolbar" style="align-items: baseline"><button data-design-id="button">One</button></div></div>');
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('button', { margin: '12px' }));
    theme.layout!.containers.push({
      id: 'flow-toolbar',
      ...context,
      nodeId: 'toolbar',
      order: ['button'],
      direction: 'column',
      padding: '8px',
      alignment: 'center',
      distribution: 'space-between',
    });
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);

    const toolbar = root.querySelector<HTMLElement>('[data-design-id="toolbar"]')!;
    expect(toolbar.style.flexDirection).toBe('column');
    expect(toolbar.style.padding).toBe('8px');
    expect(toolbar.style.alignItems).toBe('center');
    expect(toolbar.style.justifyContent).toBe('space-between');
    expect(toolbar.getAttribute('style') ?? '').not.toContain('gap');
    expect(root.querySelector<HTMLElement>('button')!.style.margin).toBe('12px');

    theme.layout = { containers: [], placements: [] };
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(toolbar.style.flexDirection).toBe('');
    expect(toolbar.style.padding).toBe('');
    expect(toolbar.style.alignItems).toBe('baseline');
    expect(toolbar.style.justifyContent).toBe('');
    expect(root.querySelector<HTMLElement>('button')!.style.margin).toBe('');
  });

  it('leaves container styles alone when direction is auto or layout fields are absent', () => {
    const root = mount('<div data-design-id="toolbar"><button data-design-id="button">One</button></div>');
    let theme = createDefaultTheme(BASE);
    theme.layout!.containers.push({ id: 'flow-toolbar', ...context, nodeId: 'toolbar', order: ['button'], direction: 'auto' });
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);

    const toolbar = root.querySelector<HTMLElement>('[data-design-id="toolbar"]')!;
    expect(toolbar.style.display).toBe('');
    expect(toolbar.style.flexDirection).toBe('');
    expect(toolbar.style.alignItems).toBe('');
    expect(toolbar.style.justifyContent).toBe('');
    expect(toolbar.style.padding).toBe('');
  });

  it('keeps authored container styles when layout fields are absent', () => {
    const root = mount('<div data-design-id="toolbar" style="align-items: baseline; justify-content: space-between; padding: 20px"><button data-design-id="button">One</button></div>');
    let theme = createDefaultTheme(BASE);
    theme.layout!.containers.push({ id: 'flow-toolbar', ...context, nodeId: 'toolbar', order: ['button'], direction: 'column' });
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);

    const toolbar = root.querySelector<HTMLElement>('[data-design-id="toolbar"]')!;
    expect(toolbar.style.flexDirection).toBe('column');
    // Fields the record does not set must keep the authored inline values, not be deleted.
    expect(toolbar.style.alignItems).toBe('baseline');
    expect(toolbar.style.justifyContent).toBe('space-between');
    expect(toolbar.style.padding).toBe('20px');
  });

  it('restores authored container styles when a managed field disappears and on undo', async () => {
    const root = mount('<div data-design-id="toolbar" style="align-items: baseline; padding: 20px"><button data-design-id="button">One</button></div>');
    let theme = createDefaultTheme(BASE);
    theme.layout!.containers.push({ id: 'flow-toolbar', ...context, nodeId: 'toolbar', order: ['button'], direction: 'column', alignment: 'center' });
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);
    const toolbar = root.querySelector<HTMLElement>('[data-design-id="toolbar"]')!;
    expect(toolbar.style.alignItems).toBe('center');

    // The alignment edit is reverted: the record now only orders and directs, so the authored
    // spacing must come back instead of being deleted together with the managed value.
    theme.layout = { containers: [{ id: 'flow-toolbar', ...context, nodeId: 'toolbar', order: ['button'], direction: 'column' }], placements: [] };
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(toolbar.style.alignItems).toBe('baseline');
    expect(toolbar.style.padding).toBe('20px');

    theme.layout = { containers: [], placements: [] };
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(toolbar.style.alignItems).toBe('baseline');
    expect(toolbar.style.padding).toBe('20px');
    expect(toolbar.style.flexDirection).toBe('');
  });
});

describe('reparent across containers', () => {
  it('moves nodes across parents to match the recorded container order and moves them back on undo', async () => {
    const root = mount('<div data-design-id="screen"><div data-design-id="toolbar-a"><button data-design-id="button">Go</button></div><div data-design-id="toolbar-b"><span data-design-id="badge">N</span></div></div>');
    let theme = createDefaultTheme(BASE);
    theme.layout = {
      containers: [
        { id: 'flow-a', ...context, nodeId: 'toolbar-a', order: [] },
        { id: 'flow-b', ...context, nodeId: 'toolbar-b', order: ['badge', 'button'] },
      ],
      placements: [],
    };
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);

    const toolbarA = () => root.querySelector<HTMLElement>('[data-design-id="toolbar-a"]')!;
    const toolbarB = () => root.querySelector<HTMLElement>('[data-design-id="toolbar-b"]')!;
    const texts = (element: HTMLElement) => [...element.children].map((child) => child.textContent);
    expect(texts(toolbarB())).toEqual(['N', 'Go']);

    theme.layout = { containers: [], placements: [] };
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(texts(toolbarA())).toEqual(['Go']);
    expect(texts(toolbarB())).toEqual(['N']);
  });

  it('skips recorded orders that would move a node into its own descendant', () => {
    const root = mount('<div data-design-id="screen"><div data-design-id="panel"><button data-design-id="button">Go</button></div></div>');
    let theme = createDefaultTheme(BASE);
    theme.layout = {
      containers: [{ id: 'flow-panel', ...context, nodeId: 'panel', order: ['screen'] }],
      placements: [],
    };
    theme = parseThemeDocument(theme);

    // A cycle would make the runtime append the screen into its own descendant and throw
    // HierarchyRequestError; the move is rejected instead so the tree stays untouched.
    expect(() => {
      cleanup = observeLayout(root, theme, context);
    }).not.toThrow();

    const screen = root.querySelector<HTMLElement>('[data-design-id="screen"]')!;
    const panel = root.querySelector<HTMLElement>('[data-design-id="panel"]')!;
    expect(panel.parentElement).toBe(screen);
    expect(screen.contains(panel)).toBe(true);
  });
});

describe('locked placements in the preview runtime', () => {
  it('keeps applying the saved appearance and hidden state of a locked placement', async () => {
    const root = mount(`
      <div data-design-id="card-grid">
        <div class="m-card" data-key="hash-1" data-design-id="card">A</div>
        <div class="m-card" data-key="hash-2" data-design-id="card">B</div>
      </div>`);
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'absolute', x: 40, y: 24, locked: true, hidden: true }));
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);

    const locked = root.querySelector<HTMLElement>('[data-key="hash-1"]')!;
    expect(locked.style.position).toBe('absolute');
    expect(locked.style.left).toBe('0.4%');
    expect(locked.style.top).toBe('0.24%');
    expect(locked.style.display).toBe('none');
    expect(locked.dataset.layoutHidden).toBe('1');

    // A refresh after any mutation must not reset the locked appearance: the lock only blocks
    // editor edits, it never skips the record in the runtime.
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(locked.style.position).toBe('absolute');
    expect(locked.style.display).toBe('none');
  });

  it('applies the newest saved coordinates when a locked placement is edited', async () => {
    const root = mount(`
      <div data-design-id="card-grid">
        <div class="m-card" data-key="hash-1" data-design-id="card">A</div>
        <div class="m-card" data-key="hash-2" data-design-id="card">B</div>
      </div>`);
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'absolute', x: 40, y: 24, locked: true }));
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);
    const locked = root.querySelector<HTMLElement>('[data-key="hash-1"]')!;
    expect(locked.style.left).toBe('0.4%');

    theme.layout = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'absolute', x: 80, y: 50, locked: true })).layout;
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(locked.style.left).toBe('0.8%');
    expect(locked.style.top).toBe('0.5%');
  });
});

describe('container records alongside placements', () => {
  it('keeps container padding, direction and alignment when the node also carries a placement', async () => {
    const root = mount('<div data-design-id="toolbar"><button data-design-id="button">One</button></div>');
    let theme = createDefaultTheme(BASE);
    theme.layout!.containers.push({
      id: 'flow-toolbar',
      ...context,
      nodeId: 'toolbar',
      order: ['button'],
      direction: 'column',
      padding: '8px',
      alignment: 'center',
    });
    theme = upsertLayoutPlacement(theme, placement('toolbar', { margin: '12px' }));
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);

    const toolbar = root.querySelector<HTMLElement>('[data-design-id="toolbar"]')!;
    expect(toolbar.style.flexDirection).toBe('column');
    expect(toolbar.style.padding).toBe('8px');
    expect(toolbar.style.alignItems).toBe('center');
    expect(toolbar.style.margin).toBe('12px');
  });

  it('keeps container padding when a label-only placement lands after the padding edit', async () => {
    const root = mount('<div data-design-id="toolbar"><button data-design-id="button">One</button></div>');
    let theme = createDefaultTheme(BASE);
    theme.layout!.containers.push({ id: 'flow-toolbar', ...context, nodeId: 'toolbar', order: ['button'], padding: '8px' });
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);
    const toolbar = root.querySelector<HTMLElement>('[data-design-id="toolbar"]')!;
    expect(toolbar.style.padding).toBe('8px');

    // Renaming the container in the editor upserts a label-only placement record; the next
    // refresh applies both records, and the placement pass must not wipe the container styles.
    theme.layout = upsertLayoutPlacement(theme, placement('toolbar', { label: 'Панель инструментов' })).layout;
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(toolbar.style.padding).toBe('8px');
    expect(toolbar.dataset.layoutMode).toBe('flow');
  });
});

describe('layout identity from anchors', () => {
  it('maps a saved edit to the same anchored card after reopening in a different order', async () => {
    const first = mount(`
      <div data-design-id="card-grid">
        <button class="m-card" data-anchor="aaa111" data-design-id="card">A</button>
        <button class="m-card" data-anchor="bbb222" data-design-id="card">B</button>
      </div>`);
    const firstNodes = collectLayoutNodes(first);
    const bNode = firstNodes.find((node) => node.label === 'B')!;
    expect(bNode.nodeId).toBe('key-bbb222');

    // The editor saved a hidden placement for card B.
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement(bNode.nodeId, { hidden: true }));
    theme = parseThemeDocument(theme);
    first.remove();

    // Reopening the page brings the list in a different order: card B now renders first.
    const second = mount(`
      <div data-design-id="card-grid">
        <button class="m-card" data-anchor="bbb222" data-design-id="card">B</button>
        <button class="m-card" data-anchor="aaa111" data-design-id="card">A</button>
      </div>`);
    cleanup = observeLayout(second, theme, context);

    const cardB = second.querySelector<HTMLElement>('[data-anchor="bbb222"]')!;
    const cardA = second.querySelector<HTMLElement>('[data-anchor="aaa111"]')!;
    expect(cardB.style.display).toBe('none');
    expect(cardA.style.display).toBe('');
  });

  it('throws on duplicate anchors instead of mapping two items to one id', () => {
    const root = mount(`
      <div data-design-id="card-grid">
        <button class="m-card" data-anchor="dup1" data-design-id="card">A</button>
        <button class="m-card" data-anchor="dup1" data-design-id="card">B</button>
      </div>`);
    const theme = createDefaultTheme(BASE);

    expect(() => observeLayout(root, theme, context)).toThrow(/duplicate data anchor/);
  });
});

describe('placement size basis', () => {
  it('resolves percent sizes against the captured basis when the parent shrinks', async () => {
    const root = mount(`
      <div data-design-id="pane" style="height: 200px">
        <div class="m-card" data-key="hash-1" data-design-id="card">A</div>
        <div class="m-card" data-key="hash-2" data-design-id="card">B</div>
      </div>`);
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('key-hash-1', {
      mode: 'absolute', x: 0, y: 0, width: 5000, height: 5000, basisWidth: 400, basisHeight: 400,
    }));
    theme = upsertLayoutPlacement(theme, placement('key-hash-2', {
      mode: 'absolute', x: 0, y: 0, width: 5000, height: 5000,
    }));
    theme = parseThemeDocument(theme);

    cleanup = observeLayout(root, theme, context);

    const withBasis = root.querySelector<HTMLElement>('[data-key="hash-1"]')!;
    const withoutBasis = root.querySelector<HTMLElement>('[data-key="hash-2"]')!;
    // 50% resolved at apply time: hash-1 against the captured 400px basis (200px), hash-2 as
    // a live percent of the 200px pane.
    expect(withBasis.style.height).toBe('200px');
    expect(withoutBasis.style.height).toBe('50%');

    // The pane shrinks once its children leave the flow; the basis-backed child keeps the
    // measured size while the plain percent child follows the smaller parent.
    root.querySelector<HTMLElement>('[data-design-id="pane"]')!.style.height = '100px';
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(withBasis.style.height).toBe('200px');
    expect(withoutBasis.style.height).toBe('50%');
  });
});

describe('competing container destinations', () => {
  const competingTheme = () => {
    const theme = createDefaultTheme(BASE);
    theme.layout = {
      containers: [
        { id: 'flow-pane-b', ...context, nodeId: 'pane-b', order: ['node-x'] },
        { id: 'flow-pane-c', ...context, nodeId: 'pane-c', order: ['node-x'] },
      ],
      placements: [],
    };
    return parseThemeDocument(theme);
  };

  it('keeps a node in the first destination order when a crafted document lists it twice', () => {
    const root = mount('<div data-design-id="screen"><div data-design-id="pane-b"></div><div data-design-id="pane-c"></div><div data-design-id="node-x">X</div></div>');
    cleanup = observeLayout(root, competingTheme(), context);

    const nodeX = root.querySelector<HTMLElement>('[data-design-id="node-x"]')!;
    const paneB = root.querySelector<HTMLElement>('[data-design-id="pane-b"]')!;
    const paneC = root.querySelector<HTMLElement>('[data-design-id="pane-c"]')!;
    // One refresh, one decision: the first destination order wins and the later claim is
    // ignored, so a crafted document cannot bounce the node between containers.
    expect(nodeX.parentElement).toBe(paneB);
    expect(paneC.contains(nodeX)).toBe(false);
  });

  it('does not oscillate between two destination orders across refreshes', async () => {
    const root = mount('<div data-design-id="screen"><div data-design-id="pane-b"></div><div data-design-id="pane-c"></div><div data-design-id="node-x">X</div></div>');
    cleanup = observeLayout(root, competingTheme(), context);

    const nodeX = root.querySelector<HTMLElement>('[data-design-id="node-x"]')!;
    const paneB = root.querySelector<HTMLElement>('[data-design-id="pane-b"]')!;
    for (let round = 0; round < 4; round += 1) {
      root.appendChild(document.createElement('span'));
      await Promise.resolve();
      expect(nodeX.parentElement).toBe(paneB);
    }
  });
});

describe('layout containing blocks', () => {
  it('sets position relative on an unpositioned layout parent and cleans it up', async () => {
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'absolute', x: 40, y: 24 }));
    const root = mount(`
      <div data-design-id="card-grid">
        <div class="m-card" data-key="hash-1" data-design-id="card">A</div>
        <div class="m-card" data-key="hash-2" data-design-id="card">B</div>
      </div>`);
    cleanup = observeLayout(root, theme, context);

    const grid = root.querySelector<HTMLElement>('[data-design-id="card-grid"]')!;
    expect(grid.style.position).toBe('relative');
    expect(grid.dataset.layoutParent).toBe('1');
    expect(root.style.position).toBe('');

    theme.layout = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'flow', x: 0, y: 0 })).layout;
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(grid.style.position).toBe('');
    expect(grid.dataset.layoutParent).toBeUndefined();
  });

  it('preserves an explicitly positioned parent and never touches it', async () => {
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'absolute', x: 40, y: 24 }));
    const root = mount(`
      <div data-design-id="card-grid" style="position: fixed">
        <div class="m-card" data-key="hash-1" data-design-id="card">A</div>
        <div class="m-card" data-key="hash-2" data-design-id="card">B</div>
      </div>`);
    cleanup = observeLayout(root, theme, context);

    const grid = root.querySelector<HTMLElement>('[data-design-id="card-grid"]')!;
    expect(grid.style.position).toBe('fixed');
    expect(grid.dataset.layoutParent).toBeUndefined();
  });

  it('keeps a managed parent positioned while any absolute child remains', async () => {
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'absolute', x: 40, y: 24 }));
    theme = upsertLayoutPlacement(theme, placement('key-hash-2', { mode: 'absolute', x: 60, y: 40, nodeId: 'key-hash-2' }));
    const root = mount(`
      <div data-design-id="card-grid">
        <div class="m-card" data-key="hash-1" data-design-id="card">A</div>
        <div class="m-card" data-key="hash-2" data-design-id="card">B</div>
      </div>`);
    cleanup = observeLayout(root, theme, context);

    const grid = root.querySelector<HTMLElement>('[data-design-id="card-grid"]')!;
    expect(grid.style.position).toBe('relative');

    theme.layout = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'flow', x: 0, y: 0 })).layout;
    root.appendChild(document.createElement('span'));
    await Promise.resolve();
    expect(grid.style.position).toBe('relative');

    theme.layout = upsertLayoutPlacement(theme, placement('key-hash-2', { mode: 'flow', x: 0, y: 0, nodeId: 'key-hash-2' })).layout;
    root.appendChild(document.createElement('span'));
    await Promise.resolve();
    expect(grid.style.position).toBe('');
  });

  it('restores the containing block on repeated refreshes while the parent has its own placement', async () => {
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement('card-grid', { margin: '12px' }));
    theme = upsertLayoutPlacement(theme, placement('key-hash-1', { mode: 'absolute', x: 40, y: 24 }));
    const root = mount(`
      <div data-design-id="card-grid">
        <div class="m-card" data-key="hash-1" data-design-id="card">A</div>
        <div class="m-card" data-key="hash-2" data-design-id="card">B</div>
      </div>`);
    cleanup = observeLayout(root, theme, context);

    const grid = root.querySelector<HTMLElement>('[data-design-id="card-grid"]')!;
    expect(grid.style.position).toBe('relative');
    expect(grid.dataset.layoutParent).toBe('1');

    // The parent carries its own placement: every refresh its inline styles are rebuilt, which
    // wipes the runtime-owned position. The containing block pass must notice the stale flag
    // and promote the parent again so the absolute child cannot jump to another ancestor.
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(grid.style.position).toBe('relative');
    expect(grid.dataset.layoutParent).toBe('1');
    expect(grid.style.margin).toBe('12px');

    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(grid.style.position).toBe('relative');
    expect(grid.style.margin).toBe('12px');
  });
});
