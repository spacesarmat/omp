// Context of the unified search on the phone: native http and Keystore secrets, the chosen TorrServer.
import { client } from '../../src/store/servers';
import { nativeBilling, secrets, sourceHttp } from './platform/native';
import type { SourceContext } from '../../src/sources/types';

export function phoneSourceContext(): SourceContext {
  const ctx: SourceContext = { http: sourceHttp, client: client.value, secrets };
  if (nativeBilling) ctx.billing = nativeBilling;
  return ctx;
}
