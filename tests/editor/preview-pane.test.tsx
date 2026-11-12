import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewPane } from '../../editor/src/components/PreviewPane';
import * as protocol from '../../editor/src/preview/protocol';
import { createDefaultDraft } from '../../editor/shared/draft';
import { getEditorViewport } from '../../editor/shared/routes';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;

type PreviewPaneProps = Parameters<typeof PreviewPane>[0];

function createProps(overrides: Partial<PreviewPaneProps> = {}): PreviewPaneProps {
  const draft = createDefaultDraft('draft-1', BASE);
  return {
    sessionId: 'session-1',
    target: 'android-phone',
    route: 'settings',
    format: 'landscape',
    language: 'ru',
    mode: 'design',
    serverConnected: false,
    state: 'default',
    theme: draft.theme,
    flow: draft.flow,
    zoom: 1,
    tool: 'select',
    selection: { ids: [], anchorId: null },
    onZoomChange: vi.fn(),
    onTool: vi.fn(),
    onSelect: vi.fn(),
    onNavigate: vi.fn(),
    onTrace: vi.fn(),
    onNodesChange: vi.fn(),
    onGeometryChange: vi.fn(),
    onSelectNode: vi.fn(),
    onMoveNode: vi.fn(),
    onPlaceNode: vi.fn(),
    onPlaceNodes: vi.fn(),
    ...overrides,
  };
}

function loadIframe(): { iframe: HTMLIFrameElement; doc: Document } {
  const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
  const doc = iframe.contentDocument!;
  if (!doc.documentElement) doc.appendChild(doc.createElement('html'));
  if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
  doc.body.innerHTML = '';
  const root = doc.createElement('div');
  root.setAttribute('data-design-root', '');
  const card = doc.createElement('div');
  card.setAttribute('data-design-id', 'card');
  root.appendChild(card);
  doc.body.appendChild(root);
  act(() => {
    iframe.dispatchEvent(new Event('load'));
  });
  return { iframe, doc };
}

function lastGeometry(props: PreviewPaneProps) {
  const calls = (props.onGeometryChange as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][0] as { format: string; screenId: string; viewport: { width: number; height: number } } | null;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
});

describe('PreviewPane geometry collection', () => {
  it('collects mutations with the current format and route, not the load-render ones', async () => {
    const props = createProps();
    act(() => render(h(PreviewPane, props), host));
    const { doc } = loadIframe();
    expect(props.onGeometryChange).toHaveBeenCalled();
    expect(lastGeometry(props)).toMatchObject({ format: 'landscape', screenId: 'settings' });

    // Orientation change re-renders the same iframe: no reload, new format prop.
    act(() => render(h(PreviewPane, { ...props, format: 'portrait' }), host));
    await act(async () => {
      await Promise.resolve();
    });
    expect(lastGeometry(props)).toMatchObject({ format: 'portrait', screenId: 'settings' });

    // A later DOM mutation must not resurrect the stale load-render geometry.
    await act(async () => {
      doc.body.appendChild(doc.createElement('div'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const snapshot = lastGeometry(props);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.format).toBe('portrait');
    expect(snapshot!.viewport).toEqual(getEditorViewport('android-phone', 'portrait'));
  });
});
