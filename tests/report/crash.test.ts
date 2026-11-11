import { describe, expect, it } from 'vitest';
import { buildCrash, crashBody, crashFingerprint, crumb } from '../../src/report/crash';

describe('crash report contract', () => {
  it('scrubs secrets and keeps the same fingerprint for the same stack', () => {
    crumb('screen library');
    const a = buildCrash({ kind: 'window', message: 'Bearer abc magnet:?xt=secret', stack: 'at run (app.js:10:2)', platform: 'phone' });
    expect(a.message).not.toContain('abc');
    expect(a.message).not.toContain('xt=secret');
    expect(a.crumbs.join(' ')).toContain('screen');
    expect(crashFingerprint('x', 'at run (app.js:10:2)')).toBe(crashFingerprint('y', 'at run (app.js:99:1)'));
    const body = crashBody(a, true);
    expect(body.diagnostics).toBe('1');
    expect(body.payload).toContain('phone');
  });
});
