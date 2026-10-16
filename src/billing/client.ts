import { billingOrigins, rememberBillingOrigin } from './config';
import type { HttpOptions, HttpResponse, SourceContext } from '../sources/types';

/**
 * Call billing API: try public host, then LAN (or reverse if LAN worked last).
 * Network failures fall through; HTTP status codes do not.
 */
export function billingGet(ctx: SourceContext, path: string, opts?: HttpOptions): Promise<HttpResponse> {
  return tryOrigins(opts, (origin, o) => ctx.http.get(origin + path, o));
}

export function billingPost(
  ctx: SourceContext,
  path: string,
  body: { [key: string]: string },
  opts?: HttpOptions,
): Promise<HttpResponse> {
  return tryOrigins(opts, (origin, o) => ctx.http.post(origin + path, body, o));
}

function tryOrigins(
  opts: HttpOptions | undefined,
  run: (origin: string, opts?: HttpOptions) => Promise<HttpResponse>,
): Promise<HttpResponse> {
  const origins = billingOrigins();
  function at(i: number): Promise<HttpResponse> {
    const origin = origins[i];
    return run(origin, opts).then(
      (res) => {
        rememberBillingOrigin(origin);
        return res;
      },
      () => {
        if (i + 1 < origins.length) return at(i + 1);
        return Promise.reject(new Error('billing unreachable'));
      },
    );
  }
  return at(0);
}
