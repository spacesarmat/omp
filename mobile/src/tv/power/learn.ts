// Talks to the ESP learner (hardware/ir-learner): pair, then one capture.
// The phone uses the native HTTP bridge so the localhost page is not blocked by CORS.
import { parseLearnerBody } from './irParse';
import type { IrSignal } from './irCodes';

export interface LearnerResponse {
  status: number;
  text: string;
}

export type LearnerHttp = (req: { url: string; method: 'GET' | 'POST'; headers?: { [name: string]: string } }) => Promise<LearnerResponse>;

export function learnerOrigin(ip: string, port: number): string {
  const p = port > 0 ? port : 80;
  return 'http://' + ip + ':' + p;
}

async function pair(origin: string, http: LearnerHttp, onToken: (token: string) => Promise<void>): Promise<string> {
  const res = await http({ url: origin + '/api/pair', method: 'POST' });
  const body = JSON.parse(res.text || 'null') as { token?: unknown } | null;
  if (res.status !== 200 || !body || typeof body.token !== 'string' || !/^[0-9a-f]{16,64}$/.test(body.token)) {
    throw new Error('pair');
  }
  await onToken(body.token);
  return body.token;
}

/**
 * Pairs when there is no token, saves it before waiting for a button, then polls one capture.
 * A 401 means the learner forgot the token (it rebooted): pair once more and try again.
 */
export async function captureLearner(
  origin: string,
  token: string | null,
  http: LearnerHttp,
  onToken: (token: string) => Promise<void>,
): Promise<{ token: string; signal: IrSignal }> {
  let auth = token;
  if (!auth) auth = await pair(origin, http, onToken);
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 0; i < 40; i++) {
      const cap = await http({ url: origin + '/api/capture', method: 'GET', headers: { Authorization: 'Bearer ' + auth } });
      if (cap.status === 401) break;
      if (cap.status === 204) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      const signal = parseLearnerBody(JSON.parse(cap.text || 'null'));
      if (cap.status === 200 && signal) return { token: auth, signal };
      throw new Error('capture');
    }
    if (attempt === 1) break;
    auth = await pair(origin, http, onToken);
  }
  throw new Error('capture');
}
