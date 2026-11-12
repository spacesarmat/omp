import { afterEach, describe, expect, it, vi } from 'vitest';

const generated = vi.hoisted(() => ({
  layout: {
    containers: [] as import('../../design/layout').LayoutContainer[],
    placements: [] as import('../../design/layout').LayoutPlacement[],
    clones: [] as import('../../design/layout').LayoutClone[],
  },
}));

vi.mock('../../design/generated/layout.ts', () => ({ PRODUCTION_LAYOUT: generated.layout }));

import { createDefaultTheme } from '../../design/defaults';
import { observeLayout } from '../../design/layoutDom';
import { desktopTargetForPlatform, installProductionDesign, resolveProductionFormat } from '../../design/production';
import type { LayoutContainer, LayoutDocument, LayoutPlacement } from '../../design/layout';

const productionContext = { target: 'android-phone', screenId: 'library', format: 'landscape' } as const;

function container(patch: Partial<LayoutContainer> = {}): LayoutContainer {
  return {
    id: 'flow-card-grid',
    target: productionContext.target,
    screenId: productionContext.screenId,
    format: productionContext.format,
    nodeId: 'card-grid',
    order: [],
    ...patch,
  };
}

function placement(patch: Partial<LayoutPlacement> = {}): LayoutPlacement {
  return {
    id: 'placement-node',
    target: productionContext.target,
    screenId: productionContext.screenId,
    format: productionContext.format,
    nodeId: 'key-hash-1',
    mode: 'flow',
    x: 0,
    y: 0,
    anchor: 'top-left',
    width: 'auto',
    height: 'auto',
    zIndex: 0,
    hidden: false,
    locked: false,
    label: 'node',
    ...patch,
  };
}

const GRID = `
  <div data-design-id="card-grid">
    <div class="m-card" data-key="hash-1" data-design-id="card">A</div>
    <div class="m-card" data-key="hash-2" data-design-id="card">B</div>
  </div>`;

const keys = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-key]')].map((element) => element.getAttribute('data-key'));

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  generated.layout.containers = [];
  generated.layout.placements = [];
  generated.layout.clones = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('resolveProductionFormat', () => {
  it('reports portrait for a tall window and landscape for a wide one', () => {
    expect(resolveProductionFormat(720, 1280)).toBe('portrait');
    expect(resolveProductionFormat(1280, 720)).toBe('landscape');
    expect(resolveProductionFormat(1080, 1080)).toBe('landscape');
  });
});

describe('desktopTargetForPlatform', () => {
  it('maps the desktop bridge platform to a design target', () => {
    expect(desktopTargetForPlatform('windows-x64')).toBe('desktop-windows');
    expect(desktopTargetForPlatform('macos-arm64')).toBe('desktop-macos');
    expect(desktopTargetForPlatform('macos-x64')).toBe('desktop-macos');
    expect(desktopTargetForPlatform('linux-x64')).toBe('desktop-linux');
    expect(desktopTargetForPlatform('linux-arm64')).toBe('desktop-linux');
    expect(desktopTargetForPlatform('')).toBe('desktop-windows');
  });
});

describe('installProductionDesign', () => {
  it('writes the production context and tracks route and format changes', () => {
    let screen = 'library';
    const holder: { notify?: () => void } = {};
    const root = document.createElement('div');
    root.innerHTML = GRID;
    document.body.appendChild(root);

    const stop = installProductionDesign(root, {
      target: 'android-phone',
      screenOf: () => screen,
      subscribeScreen: (callback) => {
        holder.notify = callback;
        return () => {
          delete holder.notify;
        };
      },
    });
    cleanup = stop;

    expect(root.getAttribute('data-design-target')).toBe('android-phone');
    expect(root.getAttribute('data-design-screen')).toBe('library');
    expect(root.getAttribute('data-design-format')).toBe('landscape');

    screen = 'settings';
    holder.notify?.();
    expect(root.getAttribute('data-design-screen')).toBe('settings');

    vi.stubGlobal('innerWidth', 720);
    vi.stubGlobal('innerHeight', 1280);
    window.dispatchEvent(new Event('resize'));
    expect(root.getAttribute('data-design-format')).toBe('portrait');

    stop();
    cleanup = undefined;
    screen = 'library';
    holder.notify?.();
    expect(root.getAttribute('data-design-screen')).toBeNull();
  });

  it('registers stable component ids on real production markup', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="screen">
        <div class="m-card">Card</div>
        <div class="list-item">Row</div>
        <div class="choice-row">Choice</div>
        <div class="m-set-row">Setting</div>
        <button class="button" type="button">Go</button>
        <input class="text-input" value="x" />
        <div data-design-id="authored">Authored</div>
      </div>`;
    document.body.appendChild(root);

    cleanup = installProductionDesign(root, { target: 'lg-webos', screenOf: () => 'library' });

    expect(root.querySelector<HTMLElement>('.m-card')!.dataset.designComponent).toBe('card');
    expect(root.querySelector<HTMLElement>('.list-item')!.dataset.designComponent).toBe('card');
    expect(root.querySelector<HTMLElement>('.choice-row')!.dataset.designComponent).toBe('choice-row');
    expect(root.querySelector<HTMLElement>('.m-set-row')!.dataset.designComponent).toBe('choice-row');
    expect(root.querySelector<HTMLElement>('.button')!.dataset.designComponent).toBe('button');
    expect(root.querySelector<HTMLElement>('button')!.dataset.designComponent).toBe('button');
    expect(root.querySelector<HTMLElement>('.text-input')!.dataset.designComponent).toBe('input');
    const authored = root.querySelector<HTMLElement>('[data-design-id="authored"]')!;
    expect(authored.dataset.designComponent).toBeUndefined();
    expect(authored.getAttribute('data-design-id')).toBe('authored');
  });

  it('maps the phone search route to the editor search screen in the production context', () => {
    const root = document.createElement('div');
    root.innerHTML = GRID;
    document.body.appendChild(root);

    // The standalone phone entry reports the app route name as-is; the shared mapping turns
    // the historical 'add' route into the editor 'search' screen so exported search layouts
    // match the real screen.
    cleanup = installProductionDesign(root, { target: 'android-phone', screenOf: () => 'add' });

    expect(root.getAttribute('data-design-screen')).toBe('search');
  });

  it('maps the TV search route to the editor search screen in the production context', () => {
    const root = document.createElement('div');
    root.innerHTML = GRID;
    document.body.appendChild(root);

    cleanup = installProductionDesign(root, { target: 'lg-webos', screenOf: () => 'add' });

    expect(root.getAttribute('data-design-screen')).toBe('search');
  });

  it('keeps production a no-op before an explicit export', async () => {
    const root = document.createElement('div');
    root.innerHTML = GRID;
    document.body.appendChild(root);

    cleanup = installProductionDesign(root, { target: 'android-phone', screenOf: () => 'library' });
    await Promise.resolve();

    expect(keys(root)).toEqual(['hash-1', 'hash-2']);
    for (const element of root.querySelectorAll<HTMLElement>('[data-key]')) {
      expect(element.getAttribute('style')).toBeNull();
      expect(element.getAttribute('data-layout-mode')).toBeNull();
    }
  });

  it('applies a nonempty exported layout with the real production context like the preview runtime', async () => {
    generated.layout.containers = [container({ order: ['key-hash-2', 'key-hash-1'] })];
    generated.layout.placements = [placement({ nodeId: 'key-hash-1', mode: 'absolute', x: 40, y: 24 })];

    const productionRoot = document.createElement('div');
    productionRoot.innerHTML = GRID;
    document.body.appendChild(productionRoot);
    cleanup = installProductionDesign(productionRoot, { target: 'android-phone', screenOf: () => 'library' });

    const previewRoot = document.createElement('div');
    previewRoot.innerHTML = GRID;
    document.body.appendChild(previewRoot);
    const theme = createDefaultTheme('0000000000000000000000000000000000000000');
    theme.layout = structuredClone(generated.layout as LayoutDocument);
    const stopPreview = observeLayout(previewRoot, theme, { ...productionContext });
    const previous = cleanup;
    cleanup = () => {
      previous?.();
      stopPreview();
    };

    await Promise.resolve();

    expect(keys(previewRoot)).toEqual(['hash-2', 'hash-1']);
    expect(keys(productionRoot)).toEqual(['hash-2', 'hash-1']);
    const previewItem = previewRoot.querySelector<HTMLElement>('[data-key="hash-1"]')!;
    const productionItem = productionRoot.querySelector<HTMLElement>('[data-key="hash-1"]')!;
    expect(previewItem.style.left).toBe('0.4%');
    expect(productionItem.style.left).toBe('0.4%');
    expect(productionItem.style.top).toBe('0.24%');
    expect(productionItem.style.position).toBe('absolute');
  });

  it('registers desktop shell ids on the real desktop markup and applies an exported sidebar move and nav hide', async () => {
    const desktop = { target: 'desktop-windows' as const, screenId: 'library', format: 'landscape' as const };
    generated.layout.containers = [];
    generated.layout.placements = [
      {
        id: 'placement-sidebar',
        ...desktop,
        nodeId: 'sidebar',
        mode: 'absolute',
        x: 400,
        y: 0,
        anchor: 'top-left',
        width: 'auto',
        height: 'auto',
        zIndex: 0,
        hidden: false,
        locked: false,
        label: 'sidebar',
      },
      {
        id: 'placement-nav-news',
        ...desktop,
        nodeId: 'nav-news',
        mode: 'flow',
        x: 0,
        y: 0,
        anchor: 'top-left',
        width: 'auto',
        height: 'auto',
        zIndex: 0,
        hidden: true,
        locked: false,
        label: 'nav-news',
      },
    ];
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="omp-desk-chrome">
        <aside class="omp-side is-expanded">
          <div class="omp-side-brand">OMP</div>
          <button type="button" class="omp-side-item" data-nav="library">Каталог</button>
          <button type="button" class="omp-side-item" data-nav="news">Новое</button>
          <button type="button" class="omp-side-item" data-nav="add">Поиск</button>
        </aside>
      </div>
      <div class="m-screen m-library" data-route="library"><div class="m-card">A</div></div>`;
    document.body.appendChild(root);

    cleanup = installProductionDesign(root, { target: 'desktop-windows', screenOf: () => 'library' });
    await Promise.resolve();

    const sidebar = root.querySelector<HTMLElement>('aside.omp-side')!;
    expect(sidebar.dataset.designId).toBe('sidebar');
    expect(sidebar.dataset.designComponent).toBe('sidebar');
    const news = root.querySelector<HTMLElement>('[data-nav="news"]')!;
    expect(news.dataset.designId).toBe('nav-news');
    expect(news.dataset.designComponent).toBe('sidebar-item');
    // The phone search tab keeps the historical route id 'add'; the editor design space speaks 'search'.
    expect(root.querySelector<HTMLElement>('[data-nav="add"]')!.dataset.designId).toBe('nav-search');
    const screen = root.querySelector<HTMLElement>('.m-screen')!;
    expect(screen.dataset.designId).toBe('content');

    // The exported sidebar move and the nav hide land on the real chrome.
    expect(sidebar.style.position).toBe('absolute');
    expect(sidebar.style.left).toBe('4%');
    expect(news.style.display).toBe('none');
  });

  it('stamps desktop shell ids only on desktop targets and keeps component inference everywhere', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <aside class="omp-side is-expanded">
        <button type="button" class="omp-side-item" data-nav="library">Каталог</button>
      </aside>
      <div class="m-screen" data-route="library"><div class="m-card">A</div></div>`;
    document.body.appendChild(root);

    cleanup = installProductionDesign(root, { target: 'android-phone', screenOf: () => 'library' });

    // The sidebar/content/nav contract is desktop-only; phone and TV previews use a different
    // root contract, so the shell ids must not appear on their production markup.
    expect(root.querySelector<HTMLElement>('aside.omp-side')!.dataset.designId).toBeUndefined();
    expect(root.querySelector<HTMLElement>('.omp-side-item')!.dataset.designId).toBeUndefined();
    expect(root.querySelector<HTMLElement>('.m-screen')!.dataset.designId).toBeUndefined();
    // Generic component inference still runs on every target.
    expect(root.querySelector<HTMLElement>('.m-card')!.dataset.designComponent).toBe('card');
  });

  it('installs on a root only once', () => {
    const root = document.createElement('div');
    root.innerHTML = GRID;
    document.body.appendChild(root);
    const first = installProductionDesign(root, { target: 'android-phone', screenOf: () => 'library' });
    const second = installProductionDesign(root, { target: 'android-phone', screenOf: () => 'library' });
    expect(root.getAttribute('data-design-target')).toBe('android-phone');
    second();
    expect(root.getAttribute('data-design-target')).toBe('android-phone');
    first();
  });
});
