import { phoneSourceContext } from '../../mobile/src/searchContext';
import { currentRoute, goBack, navigate, routeStack, type MRoute } from '../../mobile/src/nav';
import { showToast } from '../../mobile/src/ui/toast';
import { askConfirm } from '../../mobile/src/ui/confirm';
import { createBridge } from './platform/bridge';
import { flushCrashes, queueCrash } from '../../src/report/crash';
import { setDesktopUpdatePlatform } from '../../src/lib/updateInfo';
import { desktopTargetForPlatform, installProductionDesign } from '../../design/production.ts';
import { createProductionDispatcher, installProductionFlow } from '../../design/production-flow.ts';
import { BILLING_BOT_URL } from '../../src/billing/config';

async function boot(): Promise<void> {
  let platform = '';
  try {
    platform = await createBridge().invoke<string>('target_platform') || '';
    if (platform) setDesktopUpdatePlatform(platform);
  } catch {
    // The browser preview has no Tauri command. The feed then uses the user agent.
  }
  await import('../../mobile/src/main');
  const desktopTarget = desktopTargetForPlatform(platform);
  const stopProductionLayout = installProductionDesign(document.body, {
    target: desktopTarget,
    screenOf: () => currentRoute.value.name,
    subscribeScreen: (notify) => routeStack.subscribe(notify),
  });
  window.addEventListener('pagehide', stopProductionLayout, { once: true });
  // The desktop shell renders the phone app, so the same typed app APIs drive the exported
  // flows; the empty generated document keeps this a no-op until an explicit export.
  const stopProductionFlow = installProductionFlow(document.body, {
    target: desktopTarget,
    screenOf: () => currentRoute.value.name,
    subscribeScreen: (notify) => routeStack.subscribe(notify),
    environment: () => ({ networkOnline: navigator.onLine }),
    publishers: {
      subscribeNetwork: (notify) => {
        const update = () => notify(navigator.onLine);
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return () => {
          window.removeEventListener('online', update);
          window.removeEventListener('offline', update);
        };
      },
    },
    dispatcher: createProductionDispatcher({
      navigate: (screenId) => {
        navigate({ name: screenId } as MRoute);
        return { ok: true };
      },
      openScreen: (screenId) => {
        navigate({ name: screenId } as MRoute);
        return { ok: true };
      },
      back: () => ({ ok: goBack() }),
      toast: (message) => {
        showToast(message);
        return { ok: true };
      },
      dialog: (title, message) => {
        void askConfirm(title ? `${title}. ${message}` : message, 'OK');
        return { ok: true };
      },
      linkOpen: (url) => {
        window.open(url, '_blank', 'noopener');
        return { ok: true };
      },
      telegramOpen: (target) => {
        window.open(target === 'billing-bot' ? BILLING_BOT_URL : 'https://t.me/ompplyaer', '_blank', 'noopener');
        return { ok: true };
      },
    }),
  });
  window.addEventListener('pagehide', stopProductionFlow, { once: true });
  try {
    const text = await createBridge().invoke<string>('take_native_crashes');
    if (text) queueCrash({ kind: 'native', message: text.slice(0, 400), stack: text, platform: 'desktop' });
    await flushCrashes(phoneSourceContext);
  } catch {
    /* a missing command must not block the shell */
  }
}

void boot();
