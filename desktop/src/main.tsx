import '../../mobile/src/main';
import { createBridge } from './platform/bridge';
import { queueCrash } from '../../src/report/crash';

void createBridge()
  .invoke<string>('take_native_crashes')
  .then((text) => {
    if (text) queueCrash({ kind: 'native', message: text.slice(0, 400), stack: text, platform: 'desktop' });
  })
  .catch(() => undefined);
