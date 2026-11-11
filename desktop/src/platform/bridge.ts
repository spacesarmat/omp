import { currentTargetPlatform, desktopRuntimeInstructions } from './platform';

export type DesktopCommand = 'health' | 'target_platform' | 'server_start' | 'server_stop' | 'server_status' | 'server_update' | 'server_binary_installed' | 'native_http' | 'native_http_clear_cookies' | 'serverStatus' | 'playerOpen' | 'player_open' | 'player_pause' | 'player_control' | 'player_stop' | 'player_status' | 'update_supported' | 'update_check' | 'update_download' | 'update_apply' | 'update_pending_result' | 'take_native_crashes';
export type BridgeTransport = (command: DesktopCommand, args?: Record<string, unknown>) => Promise<unknown>;

export interface DesktopBridge {
  invoke<T>(command: DesktopCommand, args?: Record<string, unknown>): Promise<T>;
}

async function defaultTransport(command: DesktopCommand, args?: Record<string, unknown>): Promise<unknown> {
  if (command === 'health') return { status: 'ok' };
  if (command === 'take_native_crashes' && (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window))) return '';
  if (command === 'target_platform') return currentTargetPlatform();
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error(desktopRuntimeInstructions());
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(command, args);
}

export function createBridge(transport?: BridgeTransport): DesktopBridge {
  const call = transport || defaultTransport;
  return {
    invoke: async <T>(command: DesktopCommand, args?: Record<string, unknown>): Promise<T> => call(command, args) as Promise<T>,
  };
}
