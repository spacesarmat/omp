import { currentTargetPlatform, desktopRuntimeInstructions } from './platform';

export type BridgeTransport = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface DesktopBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

async function defaultTransport(command: string, args?: Record<string, unknown>): Promise<unknown> {
  if (command === 'health') return { status: 'ok' };
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
    invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => call(command, args) as Promise<T>,
  };
}
