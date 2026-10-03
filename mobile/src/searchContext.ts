// Context of the unified search on the phone: native http and Keystore secrets, the chosen TorrServer.
import { client } from '../../src/store/servers';
import { secrets, sourceHttp } from './platform/native';
import type { SourceContext } from '../../src/sources/types';

export function phoneSourceContext(): SourceContext {
  return { http: sourceHttp, client: client.value, secrets };
}
