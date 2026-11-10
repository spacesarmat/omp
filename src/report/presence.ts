// Funnel steps and a signed-in heartbeat. Diagnostics off: no steps, the linked device still checks in.
import { billingPost } from '../billing/client';
import { billingSession } from '../billing/session';
import { withDeviceToken } from '../billing/tokens';
import { APP_VERSION } from '../version';
import { loadJson, saveJson, isObject } from '../store/storage';
import { settings } from '../store/settings';
import type { SourceContext } from '../sources/types';

const KEY = 'omp.presence';

export type PresenceMemory = { install: boolean; linked: boolean };

export function emptyPresence(): PresenceMemory {
  return { install: false, linked: false };
}

export function readPresence(raw: unknown): PresenceMemory {
  const base = emptyPresence();
  if (!isObject(raw)) return base;
  base.install = raw.install === true;
  base.linked = raw.linked === true;
  return base;
}

/**
 * Install and login only. Trial, payment and renewal are decided on the server from promo uses and payments,
 * so a free promo is not counted as a payment and a renewal before expiry is not missed.
 */
export function nextSteps(prev: PresenceMemory, now: { linked: boolean }, diagnostics: boolean): { steps: string[]; next: PresenceMemory } {
  const steps: string[] = [];
  const next: PresenceMemory = { install: prev.install, linked: now.linked ? true : prev.linked };
  if (!prev.install) {
    next.install = true;
    if (diagnostics) steps.push('install');
  }
  if (now.linked && !prev.linked) {
    next.linked = true;
    if (diagnostics) steps.push('login');
  }
  return { steps, next };
}

export function presenceFields(version: string, platform: string, diagnostics: boolean, steps: string[]): { [key: string]: string } {
  return {
    version,
    platform,
    diagnostics: diagnostics ? '1' : '0',
    events: steps.join(','),
  };
}

export function startPresence(ctx: () => SourceContext, platform: string): void {
  const tick = () => {
    const diagnostics = settings.value.diagnostics !== false;
    const linked = !!billingSession();
    if (!linked && !diagnostics) return;
    const prev = readPresence(loadJson<unknown>(KEY, {}, isObject));
    const plan = nextSteps(prev, { linked }, diagnostics);
    const fields = presenceFields(APP_VERSION, platform, diagnostics, plan.steps);
    void withDeviceToken(ctx(), (headers) => billingPost(ctx(), '/v1/presence', fields, { headers, timeoutMs: 8000 }))
      .then((res) => {
        if (res.status === 200) saveJson(KEY, plan.next);
      })
      .catch(() => undefined);
  };
  tick();
  setInterval(tick, 60000);
}
