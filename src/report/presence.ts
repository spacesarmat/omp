// Funnel steps and a signed-in heartbeat. Diagnostics off: no steps, the linked device still checks in.
import { billingPost } from '../billing/client';
import { ompSubscribed } from '../billing/entitlement';
import { billingSession } from '../billing/session';
import { withDeviceToken } from '../billing/tokens';
import { APP_VERSION } from '../version';
import { loadJson, saveJson, isObject } from '../store/storage';
import { settings } from '../store/settings';
import type { SourceContext } from '../sources/types';

const KEY = 'omp.presence';

export type PresenceMemory = { install: boolean; linked: boolean; active: boolean; paidOnce: boolean };

export function emptyPresence(): PresenceMemory {
  return { install: false, linked: false, active: false, paidOnce: false };
}

export function readPresence(raw: unknown): PresenceMemory {
  const base = emptyPresence();
  if (!isObject(raw)) return base;
  base.install = raw.install === true;
  base.linked = raw.linked === true;
  base.active = raw.active === true;
  base.paidOnce = raw.paidOnce === true;
  return base;
}

/** Which funnel names to send now, and the memory to keep. */
export function nextSteps(prev: PresenceMemory, now: { linked: boolean; active: boolean }, diagnostics: boolean): { steps: string[]; next: PresenceMemory } {
  const steps: string[] = [];
  const next: PresenceMemory = { install: prev.install, linked: prev.linked, active: now.active, paidOnce: prev.paidOnce };
  if (!prev.install) {
    next.install = true;
    if (diagnostics) steps.push('install');
  }
  if (now.linked && !prev.linked) {
    next.linked = true;
    if (diagnostics) steps.push('login');
  }
  if (now.active && !prev.active) {
    if (diagnostics) steps.push(prev.paidOnce ? 'renewal' : 'payment');
    next.paidOnce = true;
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
    const plan = nextSteps(prev, { linked, active: ompSubscribed() }, diagnostics);
    saveJson(KEY, plan.next);
    const fields = presenceFields(APP_VERSION, platform, diagnostics, plan.steps);
    void withDeviceToken(ctx(), (headers) => billingPost(ctx(), '/v1/presence', fields, { headers, timeoutMs: 8000 })).catch(() => undefined);
  };
  tick();
  setInterval(tick, 60000);
}
