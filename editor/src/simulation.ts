import type { DesktopDesignTarget, FlowDocument } from '../../design/schema.ts';
import { dispatchInteraction, type InteractionTrace } from '../../design/interaction.ts';
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

export async function simulatePreviewClick(harness: PreviewHarness): Promise<SimulationResult> {
  let route = harness.startRoute || 'settings';
  let toast = '';
  const history: DesktopRouteId[] = [route];
  const trace = dispatchInteraction(
    harness.flow,
    { screenId: route, elementId: 'settings-continue', type: 'click' },
    { target: harness.target || 'desktop-windows', screenId: route, serverConnected: harness.serverConnected },
    {
      navigate: (screenId) => {
        if (!isDesktopRouteId(screenId)) throw new Error(`UNKNOWN_ROUTE: ${screenId}`);
        route = screenId;
        history.push(route);
      },
      back: () => {
        if (history.length > 1) {
          history.pop();
          route = history[history.length - 1];
        }
      },
      toast: (message) => {
        toast = message;
      },
    },
  );
  return { route, trace, realNetworkCalls: 0, toast };
}
