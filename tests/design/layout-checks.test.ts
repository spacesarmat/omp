import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTheme } from '../../design/defaults';
import { checkLayoutAccessibility, collectGeometrySnapshot, type GeometrySnapshot } from '../../design/layout-checks';

const BASE = '0000000000000000000000000000000000000000';
const TV_VIEWPORT = { width: 1920, height: 1080 };
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

let host: HTMLElement;

function mountDom(html: string): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  host.innerHTML = html;
  return host;
}

function stubRect(element: Element, rect: { x: number; y: number; width: number; height: number }): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({}),
  } as DOMRect);
}

function collectTv(root: HTMLElement, viewport = TV_VIEWPORT, screenId = 'home'): GeometrySnapshot {
  stubRect(root, { x: 0, y: 0, width: viewport.width, height: viewport.height });
  return collectGeometrySnapshot(root, { target: 'lg-webos', screenId, format: 'landscape', viewport });
}

afterEach(() => {
  host?.remove();
  host = undefined as unknown as HTMLElement;
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

describe('collectGeometrySnapshot', () => {
  it('collects real computed styles and rects for every layout node', () => {
    const root = mountDom([
      '<div data-design-id="screen">',
      '<button data-design-id="title" style="font-size: 30px; color: #112233; background: #ffffff;">Title</button>',
      '<div data-design-id="panel" style="font-size: 20px; color: #ddeeff; background: #101418;"><span>Panel text</span></div>',
      '</div>',
    ].join(''));
    stubRect(root, { x: 0, y: 0, ...DESKTOP_VIEWPORT });
    const title = root.querySelector('[data-design-id="title"]')!;
    stubRect(title, { x: 100, y: 40, width: 240, height: 60 });
    const panel = root.querySelector('[data-design-id="panel"]')!;
    stubRect(panel, { x: 0, y: 200, width: 640, height: 320 });

    const snapshot = collectGeometrySnapshot(root, { target: 'desktop-windows', screenId: 'library', format: 'landscape', viewport: DESKTOP_VIEWPORT });

    expect(snapshot.target).toBe('desktop-windows');
    expect(snapshot.viewport).toEqual(DESKTOP_VIEWPORT);
    const titleNode = snapshot.nodes.find((node) => node.nodeId === 'title')!;
    expect(titleNode.elementId).toBe('title');
    expect(titleNode.parentId).toBe('screen');
    expect(titleNode.kind).toBe('element');
    expect(titleNode.interactive).toBe(true);
    expect(titleNode.hasText).toBe(true);
    expect(titleNode.rect).toEqual({ x: 100, y: 40, width: 240, height: 60 });
    expect(titleNode.styles.fontSize).toBe(30);
    expect(titleNode.styles.color).toBe('rgb(17, 34, 51)');
    expect(titleNode.styles.backgroundColor).toBe('rgb(255, 255, 255)');
    const panelNode = snapshot.nodes.find((node) => node.nodeId === 'panel')!;
    expect(panelNode.interactive).toBe(false);
    expect(panelNode.hasText).toBe(false);
    expect(panelNode.styles.fontSize).toBe(20);
  });

  it('normalizes rects through the root box so canvas zoom does not skew geometry', () => {
    const root = mountDom('<div data-design-id="screen"><div data-design-id="card">Card</div></div>');
    stubRect(root, { x: 0, y: 0, width: 960, height: 540 });
    const card = root.querySelector('[data-design-id="card"]')!;
    stubRect(card, { x: 100, y: 100, width: 200, height: 100 });
    const snapshot = collectGeometrySnapshot(root, { target: 'desktop-windows', screenId: 'library', format: 'landscape', viewport: { width: 1920, height: 1080 } });
    expect(snapshot.nodes.find((node) => node.nodeId === 'card')!.rect).toEqual({ x: 200, y: 200, width: 400, height: 200 });
  });
});

describe('checkLayoutAccessibility', () => {
  it('flags text with contrast below 4.5:1 as an error and accepts readable text', () => {
    const root = mountDom([
      '<div data-design-id="screen" style="background: #ffffff;">',
      '<div data-design-id="bad" style="font-size: 16px; color: #888888; background: #ffffff;">Bad</div>',
      '<div data-design-id="good" style="font-size: 16px; color: #000000; background: #ffffff;">Good</div>',
      '</div>',
    ].join(''));
    const bad = root.querySelector('[data-design-id="bad"]')!;
    stubRect(bad, { x: 10, y: 10, width: 200, height: 40 });
    const good = root.querySelector('[data-design-id="good"]')!;
    stubRect(good, { x: 10, y: 60, width: 200, height: 40 });
    const snapshot = collectTv(root);
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    const contrast = issues.filter((issue) => issue.code === 'CONTRAST');
    expect(contrast).toHaveLength(1);
    expect(contrast[0].nodeId).toBe('bad');
    expect(contrast[0].severity).toBe('error');
    expect(contrast[0].message).toContain('contrast');
    expect(contrast[0].message).toContain('4.5');
  });

  it('resolves an opaque background through ancestors instead of treating it as missing', () => {
    const root = mountDom([
      '<div data-design-id="screen" style="background: #000000;">',
      '<div data-design-id="child" style="font-size: 30px; color: #ffffff;">Child</div>',
      '</div>',
    ].join(''));
    const child = root.querySelector('[data-design-id="child"]')!;
    stubRect(child, { x: 10, y: 10, width: 300, height: 60 });
    const snapshot = collectTv(root);
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    expect(issues.filter((issue) => issue.code === 'CONTRAST' && issue.nodeId === 'child')).toHaveLength(0);
  });

  it('composites translucent backgrounds through ancestors instead of reading them as opaque', () => {
    const root = mountDom([
      '<div data-design-id="screen" style="background: #101010;">',
      '<div data-design-id="badge" style="font-size: 30px; color: #ffffff; background: rgba(255, 255, 255, 0.18);">Beta</div>',
      '</div>',
    ].join(''));
    const badge = root.querySelector('[data-design-id="badge"]')!;
    stubRect(badge, { x: 10, y: 10, width: 300, height: 60 });
    const snapshot = collectTv(root);
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    // White text on an 82% transparent white badge over the dark screen composites to a dark
    // gray with high contrast; treating the translucent layer as opaque would compare white
    // against white and report a false 1:1 like m-badge-beta.
    expect(issues.filter((issue) => issue.code === 'CONTRAST' && issue.nodeId === 'badge')).toHaveLength(0);
  });

  it('falls back to the theme background token when no ancestor paints a background', () => {
    const root = mountDom('<div data-design-id="screen"><div data-design-id="lonely" style="font-size: 30px; color: #555555;">Lonely</div></div>');
    const lonely = root.querySelector('[data-design-id="lonely"]')!;
    stubRect(lonely, { x: 10, y: 10, width: 300, height: 60 });
    const darkTheme = createDefaultTheme(BASE);
    const darkIssues = checkLayoutAccessibility(collectTv(root), darkTheme);
    expect(darkIssues.some((issue) => issue.code === 'CONTRAST' && issue.nodeId === 'lonely')).toBe(true);
    const lightTheme = createDefaultTheme(BASE);
    lightTheme.tokens['--omp-color-background'] = '#ffffff';
    const lightIssues = checkLayoutAccessibility(collectTv(root), lightTheme);
    expect(lightIssues.some((issue) => issue.code === 'CONTRAST' && issue.nodeId === 'lonely')).toBe(false);
  });

  it('enforces the 24px TV font minimum as an error and leaves desktop text alone', () => {
    const root = mountDom([
      '<div data-design-id="screen">',
      '<div data-design-id="small" style="font-size: 16px; color: #ffffff; background: #000000;">Small</div>',
      '<div data-design-id="ok" style="font-size: 24px; color: #ffffff; background: #000000;">Ok</div>',
      '</div>',
    ].join(''));
    const small = root.querySelector('[data-design-id="small"]')!;
    stubRect(small, { x: 10, y: 10, width: 300, height: 40 });
    const ok = root.querySelector('[data-design-id="ok"]')!;
    stubRect(ok, { x: 10, y: 60, width: 300, height: 60 });
    const snapshot = collectTv(root);
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    const font = issues.filter((issue) => issue.code === 'TV_FONT_SIZE');
    expect(font).toHaveLength(1);
    expect(font[0].nodeId).toBe('small');
    expect(font[0].severity).toBe('error');
    expect(font[0].message).toContain('24');

    const desktopRoot = mountDom('<div data-design-id="screen"><div data-design-id="text" style="font-size: 16px; color: #ffffff; background: #000000;">Text</div></div>');
    stubRect(desktopRoot, { x: 0, y: 0, ...DESKTOP_VIEWPORT });
    const text = desktopRoot.querySelector('[data-design-id="text"]')!;
    stubRect(text, { x: 10, y: 10, width: 300, height: 40 });
    const desktopSnapshot = collectGeometrySnapshot(desktopRoot, { target: 'desktop-windows', screenId: 'library', format: 'landscape', viewport: DESKTOP_VIEWPORT });
    expect(checkLayoutAccessibility(desktopSnapshot, createDefaultTheme(BASE)).filter((issue) => issue.code === 'TV_FONT_SIZE')).toHaveLength(0);
  });

  it('warns when an interactive node has no visible focus indication', () => {
    const root = mountDom([
      '<div data-design-id="screen">',
      '<button data-design-id="bare" style="color: #ffffff; background: #000000; outline: none; box-shadow: none;">Bare</button>',
      '<button data-design-id="ring" style="color: #ffffff; background: #000000; outline-style: solid; outline-width: 3px; outline-color: #ffffff;">Ring</button>',
      '</div>',
    ].join(''));
    const bare = root.querySelector('[data-design-id="bare"]')!;
    stubRect(bare, { x: 10, y: 10, width: 120, height: 48 });
    const ring = root.querySelector('[data-design-id="ring"]')!;
    stubRect(ring, { x: 10, y: 70, width: 120, height: 48 });
    const snapshot = collectTv(root);
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    const focus = issues.filter((issue) => issue.code === 'FOCUS_INDICATION');
    expect(focus).toHaveLength(1);
    expect(focus[0].nodeId).toBe('bare');
    expect(focus[0].severity).toBe('warning');
  });

  it('accepts a stylesheet :focus outline as focus indication', () => {
    document.head.innerHTML = '<style>:focus { outline-style: solid; outline-color: #ffffff; }</style>';
    const root = mountDom('<div data-design-id="screen"><button data-design-id="btn" style="color: #ffffff; background: #000000; outline: none;">Btn</button></div>');
    const button = root.querySelector('[data-design-id="btn"]')! as HTMLElement;
    stubRect(button, { x: 10, y: 10, width: 120, height: 48 });
    button.focus();
    const snapshot = collectTv(root);
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    expect(issues.filter((issue) => issue.code === 'FOCUS_INDICATION' && issue.nodeId === 'btn')).toHaveLength(0);
  });

  it('warns about interactive targets smaller than 24px', () => {
    const root = mountDom([
      '<div data-design-id="screen">',
      '<button data-design-id="tiny" style="color: #ffffff; background: #000000; outline-style: solid;">Tiny</button>',
      '<button data-design-id="wide" style="color: #ffffff; background: #000000; outline-style: solid;">Wide</button>',
      '</div>',
    ].join(''));
    const tiny = root.querySelector('[data-design-id="tiny"]')!;
    stubRect(tiny, { x: 10, y: 10, width: 20, height: 40 });
    const wide = root.querySelector('[data-design-id="wide"]')!;
    stubRect(wide, { x: 10, y: 60, width: 48, height: 48 });
    const snapshot = collectTv(root);
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    const target = issues.filter((issue) => issue.code === 'TARGET_SIZE');
    expect(target).toHaveLength(1);
    expect(target[0].nodeId).toBe('tiny');
    expect(target[0].severity).toBe('warning');
    expect(target[0].message).toContain('24');
  });

  it('errors when a node rect extends beyond the viewport', () => {
    const root = mountDom([
      '<div data-design-id="screen">',
      '<div data-design-id="inside" style="background: #000000; color: #ffffff; font-size: 24px;">Inside</div>',
      '<div data-design-id="outside" style="background: #000000; color: #ffffff; font-size: 24px;">Outside</div>',
      '</div>',
    ].join(''));
    const inside = root.querySelector('[data-design-id="inside"]')!;
    stubRect(inside, { x: 100, y: 100, width: 300, height: 60 });
    const outside = root.querySelector('[data-design-id="outside"]')!;
    stubRect(outside, { x: 1880, y: 100, width: 200, height: 60 });
    const snapshot = collectTv(root);
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    const overflow = issues.filter((issue) => issue.code === 'OVERFLOW');
    expect(overflow).toHaveLength(1);
    expect(overflow[0].nodeId).toBe('outside');
    expect(overflow[0].severity).toBe('error');
    expect(overflow[0].message).toContain('viewport');
  });

  it('warns when two interactive nodes overlap', () => {
    const root = mountDom([
      '<div data-design-id="screen">',
      '<button data-design-id="first" style="color: #ffffff; background: #000000; outline-style: solid;">First</button>',
      '<button data-design-id="second" style="color: #ffffff; background: #000000; outline-style: solid;">Second</button>',
      '</div>',
    ].join(''));
    const first = root.querySelector('[data-design-id="first"]')!;
    stubRect(first, { x: 100, y: 100, width: 200, height: 60 });
    const second = root.querySelector('[data-design-id="second"]')!;
    stubRect(second, { x: 250, y: 120, width: 200, height: 60 });
    const snapshot = collectTv(root);
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    const overlap = issues.filter((issue) => issue.code === 'OVERLAP');
    expect(overlap).toHaveLength(1);
    expect(overlap[0].severity).toBe('warning');
    expect(overlap[0].message).toContain('first');
    expect(overlap[0].message).toContain('second');
  });

  it('keeps the relative safe area geometry identical on 1080p and 4K', () => {
    const root1080 = mountDom('<div data-design-id="screen"><div data-design-id="edge" style="background: #000000; color: #ffffff; font-size: 24px;">Edge</div></div>');
    stubRect(root1080, { x: 0, y: 0, width: 1920, height: 1080 });
    const edge1080 = root1080.querySelector('[data-design-id="edge"]')!;
    stubRect(edge1080, { x: 90, y: 500, width: 400, height: 100 });
    const issues1080 = checkLayoutAccessibility(collectGeometrySnapshot(root1080, { target: 'lg-webos', screenId: 'home', format: 'landscape', viewport: TV_VIEWPORT }), createDefaultTheme(BASE));

    const root4k = mountDom('<div data-design-id="screen"><div data-design-id="edge" style="background: #000000; color: #ffffff; font-size: 24px;">Edge</div></div>');
    stubRect(root4k, { x: 0, y: 0, width: 3840, height: 2160 });
    const edge4k = root4k.querySelector('[data-design-id="edge"]')!;
    stubRect(edge4k, { x: 180, y: 1000, width: 800, height: 200 });
    const issues4k = checkLayoutAccessibility(collectGeometrySnapshot(root4k, { target: 'lg-webos', screenId: 'home', format: 'landscape', viewport: { width: 3840, height: 2160 } }), createDefaultTheme(BASE));

    const shape = (issues: typeof issues1080) => issues
      .filter((issue) => issue.code === 'SAFE_AREA')
      .map((issue) => `${issue.severity}:${issue.code}:${issue.nodeId}`)
      .sort();
    expect(shape(issues1080)).toEqual(['warning:SAFE_AREA:edge']);
    expect(shape(issues4k)).toEqual(shape(issues1080));

    const rootSafe = mountDom('<div data-design-id="screen"><div data-design-id="center" style="background: #000000; color: #ffffff; font-size: 24px;">Center</div></div>');
    stubRect(rootSafe, { x: 0, y: 0, ...TV_VIEWPORT });
    const center = rootSafe.querySelector('[data-design-id="center"]')!;
    stubRect(center, { x: 200, y: 200, width: 800, height: 200 });
    const safeIssues = checkLayoutAccessibility(collectTv(rootSafe), createDefaultTheme(BASE));
    expect(safeIssues.filter((issue) => issue.code === 'SAFE_AREA')).toHaveLength(0);
  });

  it('skips nodes hidden by computed styles or by a hidden placement in the theme', () => {
    const theme = createDefaultTheme(BASE);
    theme.layout = {
      containers: [],
      placements: [{
        id: 'placement-secret',
        target: 'lg-webos',
        screenId: 'home',
        format: 'landscape',
        nodeId: 'secret',
        mode: 'flow',
        x: 0,
        y: 0,
        anchor: 'top-left',
        width: 'auto',
        height: 'auto',
        zIndex: 0,
        hidden: true,
        locked: false,
        label: 'Secret',
      }],
    };
    const root = mountDom([
      '<div data-design-id="screen">',
      '<div data-design-id="secret" style="font-size: 10px; color: #888888; background: #ffffff;">Secret</div>',
      '<div data-design-id="ghost" style="display: none; font-size: 10px; color: #888888; background: #ffffff;">Ghost</div>',
      '</div>',
    ].join(''));
    const secret = root.querySelector('[data-design-id="secret"]')!;
    stubRect(secret, { x: 10, y: 10, width: 100, height: 20 });
    const snapshot = collectTv(root);
    const issues = checkLayoutAccessibility(snapshot, theme);
    expect(issues.filter((issue) => issue.nodeId === 'secret')).toHaveLength(0);
    expect(issues.filter((issue) => issue.nodeId === 'ghost')).toHaveLength(0);
  });

  it('skips descendants of containers hidden by computed styles', () => {
    const root = mountDom([
      '<div data-design-id="screen">',
      '<div data-design-id="hidden-box" style="display: none;">',
      '<div data-design-id="hidden-label" style="font-size: 10px; color: #888888; background: #ffffff;">Hidden</div>',
      '<div data-design-id="fading-box" style="opacity: 0;">',
      '<div data-design-id="fading-label" style="font-size: 10px; color: #888888; background: #ffffff;">Fading</div>',
      '</div>',
      '</div>',
      '</div>',
    ].join(''));
    const issues = checkLayoutAccessibility(collectTv(root), createDefaultTheme(BASE));
    expect(issues.filter((issue) => ['hidden-label', 'fading-label'].includes(issue.nodeId))).toEqual([]);
  });

  it('skips descendants of a node hidden by a hidden placement in the theme', () => {
    const theme = createDefaultTheme(BASE);
    theme.layout = {
      containers: [],
      placements: [{
        id: 'placement-secret-box',
        target: 'lg-webos',
        screenId: 'home',
        format: 'landscape',
        nodeId: 'secret-box',
        mode: 'flow',
        x: 0,
        y: 0,
        anchor: 'top-left',
        width: 'auto',
        height: 'auto',
        zIndex: 0,
        hidden: true,
        locked: false,
        label: 'Secret box',
      }],
    };
    const root = mountDom('<div data-design-id="screen"><div data-design-id="secret-box"><div data-design-id="secret-label" style="font-size: 10px; color: #888888; background: #ffffff;">Secret</div></div></div>');
    const issues = checkLayoutAccessibility(collectTv(root), theme);
    expect(issues.filter((issue) => issue.nodeId === 'secret-label')).toEqual([]);
  });

  it('applies the 3:1 large text threshold from 24px regular and about 18.67px bold', () => {
    const root = mountDom([
      '<div data-design-id="screen" style="background: #ffffff;">',
      '<div data-design-id="regular-24" style="font-size: 24px; font-weight: 400; color: #949494; background: #ffffff;">A</div>',
      '<div data-design-id="bold-1867" style="font-size: 18.67px; font-weight: 700; color: #949494; background: #ffffff;">B</div>',
      '<div data-design-id="regular-23" style="font-size: 23px; font-weight: 400; color: #949494; background: #ffffff;">C</div>',
      '<div data-design-id="bold-1866" style="font-size: 18.66px; font-weight: 700; color: #949494; background: #ffffff;">D</div>',
      '</div>',
    ].join(''));
    for (const id of ['regular-24', 'bold-1867', 'regular-23', 'bold-1866']) {
      stubRect(root.querySelector(`[data-design-id="${id}"]`)!, { x: 10, y: 10, width: 300, height: 60 });
    }
    const issues = checkLayoutAccessibility(collectTv(root), createDefaultTheme(BASE));
    const contrast = issues.filter((issue) => issue.code === 'CONTRAST');
    expect(contrast.map((issue) => issue.nodeId)).toEqual(['regular-23', 'bold-1866']);
    expect(contrast[0].message).toContain('4.5');
  });

  it('reads focus styles without a real focus and restores the previous focus', () => {
    document.head.innerHTML = '<style>:focus { outline-style: solid; outline-width: 3px; outline-color: #ffffff; }</style>';
    const root = mountDom('<div data-design-id="screen"><button data-design-id="btn" style="color: #ffffff; background: #000000; outline: none;">Btn</button></div>');
    const button = root.querySelector<HTMLElement>('[data-design-id="btn"]')!;
    stubRect(button, { x: 10, y: 10, width: 120, height: 48 });
    const prior = document.createElement('input');
    document.body.appendChild(prior);
    prior.focus();
    const focusedDuringCollect: string[] = [];
    const record = (event: Event) => focusedDuringCollect.push((event.target as HTMLElement).dataset.designId ?? '');
    document.addEventListener('focusin', record);
    try {
      const snapshot = collectTv(root);
      // Focus styles are inspected through probe rules, so no focus event fires at all and the
      // user focus never leaves the previously focused control.
      expect(focusedDuringCollect).toEqual([]);
      expect(document.activeElement).toBe(prior);
      expect(snapshot.nodes.find((node) => node.nodeId === 'btn')!.styles.focusOutlineStyle).toBe('solid');
      expect(snapshot.nodes.find((node) => node.nodeId === 'btn')!.styles.focusOutlineWidth).toBe(3);
    } finally {
      document.removeEventListener('focusin', record);
      prior.remove();
    }
  });

  it('collects interactive focus styles without focus, keypad or scroll side effects', () => {
    document.head.innerHTML = '<style>:focus { outline-style: solid; outline-width: 2px; outline-color: #ffffff; }</style>';
    const root = mountDom('<div data-design-id="screen"><input data-design-id="field" style="color: #ffffff; background: #000000; outline: none;"><button data-design-id="btn" style="color: #ffffff; background: #000000; outline: none;">Btn</button></div>');
    const field = root.querySelector<HTMLElement>('[data-design-id="field"]')!;
    const button = root.querySelector<HTMLElement>('[data-design-id="btn"]')!;
    stubRect(field, { x: 10, y: 10, width: 200, height: 48 });
    stubRect(button, { x: 10, y: 70, width: 120, height: 48 });
    const prior = document.createElement('button');
    document.body.appendChild(prior);
    prior.focus();

    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    const scrollSpy = vi.spyOn(window, 'scrollTo');
    const focusEvents: string[] = [];
    const record = (event: Event) => focusEvents.push((event.target as HTMLElement).dataset?.designId ?? (event.target as HTMLElement).tagName);
    document.addEventListener('focusin', record);
    document.addEventListener('focus', record, true);
    try {
      const snapshot = collectTv(root);
      // Focusing an input for real would open the phone keypad and fire the app focus handlers;
      // the probe read must not call focus, scroll or emit any focus event.
      expect(focusSpy).not.toHaveBeenCalled();
      expect(scrollSpy).not.toHaveBeenCalled();
      expect(focusEvents).toEqual([]);
      expect(document.activeElement).toBe(prior);
      expect(snapshot.nodes.find((node) => node.nodeId === 'field')!.styles.focusOutlineStyle).toBe('solid');
      expect(snapshot.nodes.find((node) => node.nodeId === 'btn')!.styles.focusOutlineStyle).toBe('solid');
    } finally {
      document.removeEventListener('focusin', record);
      document.removeEventListener('focus', record, true);
      focusSpy.mockRestore();
      scrollSpy.mockRestore();
      prior.remove();
    }
  });

  it('matches focus rules by rule type when the sheet comes from another realm', () => {
    document.head.innerHTML = '<style>:focus { outline-style: solid; outline-width: 3px; outline-color: #ffffff; }</style>';
    const root = mountDom('<div data-design-id="screen"><button data-design-id="btn" style="color: #ffffff; background: #000000; outline: none;">Btn</button></div>');
    const button = root.querySelector<HTMLElement>('[data-design-id="btn"]')!;
    stubRect(button, { x: 10, y: 10, width: 120, height: 48 });
    // The measured document may live in another realm (the preview iframe): its CSSRule
    // constructors differ from the editor window ones, which must not hide real browser focus
    // rules from the probe.
    const RealStyleRule = globalThis.CSSStyleRule;
    const RealGroupingRule = globalThis.CSSGroupingRule;
    vi.stubGlobal('CSSStyleRule', class ForeignStyleRule {});
    vi.stubGlobal('CSSGroupingRule', class ForeignGroupingRule {});
    try {
      const snapshot = collectTv(root);
      expect(snapshot.nodes.find((node) => node.nodeId === 'btn')!.styles.focusOutlineStyle).toBe('solid');
      expect(snapshot.nodes.find((node) => node.nodeId === 'btn')!.styles.focusOutlineWidth).toBe(3);
    } finally {
      vi.stubGlobal('CSSStyleRule', RealStyleRule);
      vi.stubGlobal('CSSGroupingRule', RealGroupingRule);
    }
  });

  it('returns no issues for a clean snapshot', () => {
    const root = mountDom('<div data-design-id="screen"><button data-design-id="action" style="font-size: 30px; color: #ffffff; background: #000000; outline-style: solid; outline-width: 3px; outline-color: #ffffff;">Action</button></div>');
    stubRect(root, { x: 0, y: 0, ...DESKTOP_VIEWPORT });
    const action = root.querySelector('[data-design-id="action"]')!;
    stubRect(action, { x: 200, y: 200, width: 320, height: 64 });
    const snapshot = collectGeometrySnapshot(root, { target: 'desktop-windows', screenId: 'library', format: 'landscape', viewport: DESKTOP_VIEWPORT });
    expect(checkLayoutAccessibility(snapshot, createDefaultTheme(BASE))).toEqual([]);
  });

  it('ignores viewport overflow that a scrolling carousel ancestor clips away', () => {
    const root = mountDom([
      '<div data-design-id="screen">',
      '<div data-design-id="carousel" style="overflow-x: auto; background: #000000;">',
      '<div data-design-id="item-a" style="font-size: 24px; color: #ffffff; background: #000000;">A</div>',
      '<div data-design-id="item-b" style="font-size: 24px; color: #ffffff; background: #000000;">B</div>',
      '<div data-design-id="item-c" style="font-size: 24px; color: #ffffff; background: #000000;">C</div>',
      '</div>',
      '</div>',
    ].join(''));
    stubRect(root.querySelector('[data-design-id="carousel"]')!, { x: 100, y: 400, width: 1600, height: 300 });
    stubRect(root.querySelector('[data-design-id="item-a"]')!, { x: 100, y: 400, width: 400, height: 300 });
    stubRect(root.querySelector('[data-design-id="item-b"]')!, { x: 1500, y: 400, width: 600, height: 300 });
    stubRect(root.querySelector('[data-design-id="item-c"]')!, { x: 2500, y: 400, width: 400, height: 300 });
    const snapshot = collectTv(root);
    const itemB = snapshot.nodes.find((node) => node.nodeId === 'item-b')!;
    expect(itemB.clip.x).toBe(true);
    expect(itemB.clip.y).toBe(true);
    expect(itemB.clip.ancestorId).toBe('carousel');
    const screen = snapshot.nodes.find((node) => node.nodeId === 'screen')!;
    expect(screen.clip.x).toBe(false);
    expect(screen.clip.ancestorId).toBeNull();
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    expect(issues.filter((issue) => issue.code === 'OVERFLOW')).toEqual([]);
  });

  it('still reports overflow that stays visible outside the clipping chain', () => {
    const root = mountDom([
      '<div data-design-id="screen">',
      '<div data-design-id="carousel" style="overflow-x: auto; background: #000000;">',
      '<div data-design-id="item" style="font-size: 24px; color: #ffffff; background: #000000;">Item</div>',
      '</div>',
      '<div data-design-id="loose" style="font-size: 24px; color: #ffffff; background: #000000;">Loose</div>',
      '</div>',
    ].join(''));
    stubRect(root.querySelector('[data-design-id="carousel"]')!, { x: 0, y: 400, width: 2400, height: 300 });
    stubRect(root.querySelector('[data-design-id="item"]')!, { x: 100, y: 400, width: 400, height: 300 });
    stubRect(root.querySelector('[data-design-id="loose"]')!, { x: 1800, y: 900, width: 300, height: 100 });
    const issues = checkLayoutAccessibility(collectTv(root), createDefaultTheme(BASE));
    const overflow = issues.filter((issue) => issue.code === 'OVERFLOW');
    expect(overflow.map((issue) => issue.nodeId).sort()).toEqual(['carousel', 'loose']);
    expect(overflow.every((issue) => issue.severity === 'error')).toBe(true);
  });

  it('keeps carousel clipping exact through zoom-normalized rects', () => {
    const root = mountDom([
      '<div data-design-id="screen">',
      '<div data-design-id="carousel" style="overflow-x: hidden; background: #000000;">',
      '<div data-design-id="item" style="font-size: 24px; color: #ffffff; background: #000000;">Item</div>',
      '</div>',
      '<div data-design-id="loose" style="font-size: 24px; color: #ffffff; background: #000000;">Loose</div>',
      '</div>',
    ].join(''));
    stubRect(root, { x: 0, y: 0, width: 960, height: 540 });
    stubRect(root.querySelector('[data-design-id="carousel"]')!, { x: 0, y: 200, width: 800, height: 150 });
    stubRect(root.querySelector('[data-design-id="item"]')!, { x: 900, y: 200, width: 500, height: 150 });
    stubRect(root.querySelector('[data-design-id="loose"]')!, { x: 900, y: 500, width: 200, height: 100 });
    const snapshot = collectGeometrySnapshot(root, { target: 'lg-webos', screenId: 'home', format: 'landscape', viewport: TV_VIEWPORT });
    const item = snapshot.nodes.find((node) => node.nodeId === 'item')!;
    expect(item.rect).toEqual({ x: 1800, y: 400, width: 1000, height: 300 });
    expect(item.clip.ancestorId).toBe('carousel');
    const loose = snapshot.nodes.find((node) => node.nodeId === 'loose')!;
    expect(loose.clip.ancestorId).toBeNull();
    const issues = checkLayoutAccessibility(snapshot, createDefaultTheme(BASE));
    const overflow = issues.filter((issue) => issue.code === 'OVERFLOW');
    expect(overflow.map((issue) => issue.nodeId)).toEqual(['loose']);
  });
});
