import { createBridge, type BridgeTransport, type DesktopCommand } from '../platform/bridge';
import { createDesktopNative } from '../platform/createDesktopNative';
import { TargetPlatform } from '../platform/platform';
import { t } from '../../../src/i18n';

export function createPreviewTransport(onCommand?: (command: DesktopCommand) => void): BridgeTransport {
  return async (command) => {
    onCommand?.(command);
    if (command === 'health') return { status: 'ok' };
    if (command === 'target_platform') return TargetPlatform.WindowsX64;
    if (command === 'native_http') return { status: 503, base64: '', text: 'Preview network is disabled' };
    if (command === 'server_status') return { mode: 'external', origin: 'http://fixture.invalid:8090', status: 'stopped' };
    if (command === 'server_binary_installed') return true;
    if (command === 'player_status') return { state: 'idle', positionMs: 0, durationMs: 0 };
    if (command === 'update_pending_result') return null;
    return {};
  };
}

const preview = createDesktopNative(createBridge(createPreviewTransport()));

export const native = preview.native;
export const sourceHttp = preview.sourceHttp;
export const nativeBilling = preview.nativeBilling;
export const secrets = preview.secrets;
export const serverApi = preview.serverApi;
export function rawPlugin(): unknown {
  return null;
}
export const onlyAndroid = () => t('errors.onlyAndroid');
