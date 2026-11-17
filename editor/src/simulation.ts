import type { DesktopDesignTarget, FlowDocument } from '../../design/schema.ts';
import { beginFlowSession, executeFlow, resetFlowSession, type FlowDispatcher } from '../../design/flow-graph.ts';
import { createProductionDispatcher } from '../../design/production-flow.ts';
import { toInteractionTraces, type InteractionTrace } from '../../design/interaction.ts';
import { isDesktopRouteId, type DesktopRouteId } from '../../desktop/src/shell/routes';

export interface PreviewHarness {
  flow: FlowDocument;
  serverConnected: boolean;
  target?: DesktopDesignTarget;
  startRoute?: DesktopRouteId;
}

export interface SimulationResult {
  route: DesktopRouteId;
  trace: InteractionTrace[];
  realNetworkCalls: 0;
  toast: string;
}

// The preview runs the same shared interpreter as the debugger and production: legacy
// rules keep their precedence, graph rules walk their nodes, and one click is one session
// (begin, execute, reset), so variables never leak between simulation runs. The dispatcher
// is a mock typed adapter: navigation, back and toast drive the preview state, every other
// action reports a synchronous unsupported outcome instead of touching a real app API.
export async function simulatePreviewClick(harness: PreviewHarness): Promise<SimulationResult> {
  let route = harness.startRoute || 'settings';
  let toast = '';
  const history: DesktopRouteId[] = [route];
  const dispatcher: FlowDispatcher = createProductionDispatcher({
    navigate: (screenId) => {
      if (!isDesktopRouteId(screenId)) return { ok: false, error: `UNKNOWN_ROUTE: ${screenId}` };
      route = screenId;
      history.push(route);
      return { ok: true };
    },
    back: () => {
      if (history.length > 1) {
        history.pop();
        route = history[history.length - 1];
      }
      return { ok: true };
    },
    toast: (message) => {
      toast = message;
      return { ok: true };
    },
  });
  beginFlowSession({
    target: harness.target || 'desktop-windows',
    screenId: route,
    serverConnected: harness.serverConnected,
    networkOnline: true,
    accountSignedIn: false,
    playbackState: 'idle',
    downloadState: 'idle',
  });
  let result: ReturnType<typeof executeFlow>;
  try {
    result = executeFlow(harness.flow, { type: 'click', screenId: route, elementId: 'settings-continue' }, dispatcher);
  } finally {
    resetFlowSession();
  }
  return { route, trace: toInteractionTraces(harness.flow, result.trace), realNetworkCalls: 0, toast };
}
