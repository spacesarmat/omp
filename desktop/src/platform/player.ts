import { createBridge, DesktopBridge } from './bridge';

export type PlayerState = 'idle' | 'starting' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlayerOpenRequest {
  url: string;
  title?: string;
  headers?: Record<string, string>;
  startMs?: number;
}

export interface PlayerStatus {
  state: PlayerState;
  positionMs: number;
  durationMs: number;
  error?: string;
}

export interface PlayerApi {
  playerOpen(request: PlayerOpenRequest): Promise<PlayerStatus>;
  playerPause(): Promise<PlayerStatus>;
  playerControl(action: string): Promise<PlayerStatus>;
  playerStop(): Promise<PlayerStatus>;
  playerStatus(): Promise<PlayerStatus>;
}

export function createPlayerApi(bridge: DesktopBridge = createBridge()): PlayerApi {
  return {
    playerOpen: (request) => bridge.invoke<PlayerStatus>('player_open', { request }),
    playerPause: () => bridge.invoke<PlayerStatus>('player_pause'),
    playerControl: (action) => bridge.invoke<PlayerStatus>('player_control', { action }),
    playerStop: () => bridge.invoke<PlayerStatus>('player_stop'),
    playerStatus: () => bridge.invoke<PlayerStatus>('player_status'),
  };
}
