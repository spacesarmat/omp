import { BILLING_ORIGIN } from './config';
import type { HttpOptions, HttpResponse, SourceContext } from '../sources/types';

/** Calls the billing API on its public domain. A network failure rejects; HTTP statuses resolve. */
export function billingGet(ctx: SourceContext, path: string, opts?: HttpOptions): Promise<HttpResponse> {
  return ctx.http.get(BILLING_ORIGIN + path, opts);
}

export function billingPost(
  ctx: SourceContext,
  path: string,
  body: { [key: string]: string },
  opts?: HttpOptions,
): Promise<HttpResponse> {
  return ctx.http.post(BILLING_ORIGIN + path, body, opts);
}
