import { createBridge } from './platform/bridge';
import { setDesktopUpdatePlatform } from '../../src/lib/updateInfo';

async function boot(): Promise<void> {
  try {
    const platform = await createBridge().invoke<string>('target_platform');
    if (typeof platform === 'string' && platform) setDesktopUpdatePlatform(platform);
  } catch {
    // The browser preview has no Tauri command. The feed then uses the user agent.
  }
  await import('../../mobile/src/main');
}

void boot();
