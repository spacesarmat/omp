import { createBridge, DesktopBridge } from './bridge';

export const EMBEDDED_SERVER_ORIGIN = 'http://127.0.0.1:8090';

export type ServerMode = 'embedded' | 'external';
export type ServerStatus = 'stopped' | 'starting' | 'ready' | 'error';

export interface ServerStartRequest {
  mode: ServerMode;
  origin?: string;
}

export interface ServerHandle {
  mode: ServerMode;
  origin: string;
  status: ServerStatus;
  error?: string;
}

export interface ServerApi {
  serverStart(request: ServerStartRequest): Promise<ServerHandle>;
  serverStop(): Promise<ServerHandle>;
  serverStatus(): Promise<ServerHandle>;
  serverUpdate(): Promise<ServerHandle>;
}

function requestOrigin(request: ServerStartRequest): string {
  if (request.mode === 'embedded') return EMBEDDED_SERVER_ORIGIN;
  if (!request.origin) throw new Error('External TorrServer origin must use HTTP or HTTPS');
  const url = new URL(request.origin);
  if (url.origin === 'null' || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('External TorrServer origin must use HTTP or HTTPS');
  }
  return url.origin;
}

export function createServerApi(bridge: DesktopBridge = createBridge()): ServerApi {
  return {
    serverStart: async (request) => bridge.invoke<ServerHandle>('server_start', {
      request: { mode: request.mode, origin: requestOrigin(request) },
    }),
    serverStop: () => bridge.invoke<ServerHandle>('server_stop'),
    serverStatus: () => bridge.invoke<ServerHandle>('server_status'),
    serverUpdate: () => bridge.invoke<ServerHandle>('server_update'),
  };
}
