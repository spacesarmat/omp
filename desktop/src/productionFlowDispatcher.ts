import { createPhoneFlowDispatcher } from '../../mobile/src/productionFlowDispatcher';
import type { FlowDispatcher } from '../../design/production-flow';

// The desktop shell renders the phone app, so it reuses the phone dispatcher with the
// desktop URL opener; playback commands ride the same player link and report a documented
// error when no playback is active.
export function createDesktopFlowDispatcher(): FlowDispatcher {
  return createPhoneFlowDispatcher({
    openUrl: (url) => window.open(url, '_blank', 'noopener'),
  });
}
