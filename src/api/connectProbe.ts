// Connecting to a typed address: its candidates (serverAddress.ts connectCandidates) in turn, the first that answers
// /echo wins and its URL is the one saved. A failure names the URL tried first, and a refused certificate when the
// platform can tell one (tlsProbe.ts). Promise chains only: the LG bundle runs on Chromium 53.
import { apiError, isApiError } from './http';
import { certificateRefused } from './tlsProbe';

export interface ProbeOk {
  url: string;
  version: string;
}

/** Why the connect failed: the URL whose error is shown, that error, and whether its certificate was refused. */
export interface ProbeFailure {
  url: string;
  error: unknown;
  tls: boolean;
}

/**
 * The next candidate is worth a try after this failure: no answer at all (a TLS port refuses plain HTTP, a plain port
 * refuses a handshake), an answer that is not TorrServer's, or the 400 / 497 a TLS proxy gives plain HTTP. A timeout
 * is not retried: it would only double the wait.
 */
export function retryOtherScheme(e: unknown): boolean {
  if (!isApiError(e)) return false;
  if (e.kind === 'network' || e.kind === 'parse') return true;
  return e.kind === 'http' && (e.status === 400 || e.status === 497);
}

export function isProbeFailure(e: unknown): e is ProbeFailure {
  return !!e && typeof (e as ProbeFailure).url === 'string' && 'error' in (e as object) && typeof (e as ProbeFailure).tls === 'boolean';
}

/** The candidates in turn; rejects with a ProbeFailure. */
export function probeServer(candidates: string[], echo: (url: string) => Promise<string>): Promise<ProbeOk> {
  if (!candidates.length) return Promise.reject({ url: '', error: apiError('parse', 'Bad address'), tls: false } as ProbeFailure);
  const failed: { url: string; error: unknown }[] = [];
  const attempt = (i: number): Promise<ProbeOk> =>
    echo(candidates[i]).then(
      (version) => ({ url: candidates[i], version }),
      (error) => {
        failed.push({ url: candidates[i], error });
        if (i + 1 < candidates.length && retryOtherScheme(error)) return attempt(i + 1);
        return explain(failed);
      },
    );
  return attempt(0);
}

/** The first failure, unless an https one had no answer because its certificate was refused. */
function explain(failed: { url: string; error: unknown }[]): Promise<never> {
  const first = failed[0];
  let tlsCandidate: { url: string; error: unknown } | null = null;
  for (let i = 0; i < failed.length; i++) {
    const f = failed[i];
    if (/^https:/i.test(f.url) && isApiError(f.error) && f.error.kind === 'network') {
      tlsCandidate = f;
      break;
    }
  }
  if (!tlsCandidate) return Promise.reject({ url: first.url, error: first.error, tls: false } as ProbeFailure);
  const c = tlsCandidate;
  return certificateRefused(c.url).then((refused) => {
    throw (refused ? { url: c.url, error: c.error, tls: true } : { url: first.url, error: first.error, tls: false }) as ProbeFailure;
  });
}
