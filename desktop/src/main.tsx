import '../../mobile/src/main';
import { phoneSourceContext } from '../../mobile/src/searchContext';
import { createBridge } from './platform/bridge';
import { flushCrashes, queueCrash } from '../../src/report/crash';

void createBridge()
  .invoke<string>('take_native_crashes')
  .then((text) => {
    if (text) queueCrash({ kind: 'native', message: text.slice(0, 400), stack: text, platform: 'desktop' });
    return flushCrashes(phoneSourceContext);
  })
  .catch(() => undefined);
