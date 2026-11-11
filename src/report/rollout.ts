// Staged beta: the app asks billing whether this device is inside betaPercent.
import { billingGet } from '../billing/client';
import { deviceId } from '../billing/session';
import { setBetaGate } from '../store/updates';
import type { SourceContext } from '../sources/types';

export function installRollout(ctx: () => SourceContext): void {
  // webOS uses cross-origin XHR. Billing allows this GET and the X-Device-Id header on /v1/rollout only.
  setBetaGate(() =>
    billingGet(ctx(), '/v1/rollout', { headers: { 'X-Device-Id': deviceId() }, timeoutMs: 8000 }).then((res) => {
      if (res.status !== 200) return false;
      try {
        const data = JSON.parse(res.text) as { beta?: boolean };
        return data.beta === true;
      } catch {
        return false;
      }
    }),
  );
}
