import { phoneSourceContext } from '../../mobile/src/searchContext';
import { currentRoute, routeStack } from '../../mobile/src/nav';
import { createBridge } from './platform/bridge';
import { flushCrashes, queueCrash } from '../../src/report/crash';
import { setDesktopUpdatePlatform } from '../../src/lib/updateInfo';
import { desktopTargetForPlatform, installProductionDesign } from '../../design/production.ts';

async function boot(): Promise<void> {
  let platform = '';
  try {
    platform = await createBridge().invoke<string>('target_platform') || '';
    if (platform) setDesktopUpdatePlatform(platform);
  } catch {
    // The browser preview has no Tauri command. The feed then uses the user agent.
  }
  await import('../../mobile/src/main');
  const stopProductionLayout = installProductionDesign(document.body, {
    target: desktopTargetForPlatform(platform),
    screenOf: () => currentRoute.value.name,
    subscribeScreen: (notify) => routeStack.subscribe(notify),
  });
  window.addEventListener('pagehide', stopProductionLayout, { once: true });
  try {
    const text = await createBridge().invoke<string>('take_native_crashes');
    if (text) queueCrash({ kind: 'native', message: text.slice(0, 400), stack: text, platform: 'desktop' });
    await flushCrashes(phoneSourceContext);
  } catch {
    /* a missing command must not block the shell */
  }
}

void boot();
