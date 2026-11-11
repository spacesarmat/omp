// Talks to the ESP learner (hardware/ir-learner): pair, then one capture.
import { parseLearnerBody } from './irParse';
import type { IrSignal } from './irCodes';

export function learnerOrigin(ip: string, port: number): string {
  const p = port > 0 ? port : 80;
  return 'http://' + ip + ':' + p;
}

/** Pairs if there is no token yet, then waits for one button. The token is returned for the keystore. */
export async function captureLearner(origin: string, token: string | null, fetchFn: typeof fetch = fetch): Promise<{ token: string; signal: IrSignal }> {
  let auth = token;
  if (!auth) {
    const pair = await fetchFn(origin + '/api/pair', { method: 'POST' });
    const body = (await pair.json().catch(() => null)) as { token?: unknown } | null;
    if (!pair.ok || !body || typeof body.token !== 'string' || !/^[0-9a-f]{16,64}$/.test(body.token)) throw new Error('pair');
    auth = body.token;
  }
  const headers = { Authorization: 'Bearer ' + auth };
  for (let i = 0; i < 40; i++) {
    const cap = await fetchFn(origin + '/api/capture', { headers });
    if (cap.status === 204) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const signal = parseLearnerBody(await cap.json().catch(() => null));
    if (cap.ok && signal) return { token: auth, signal };
    break;
  }
  throw new Error('capture');
}
