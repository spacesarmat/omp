import { describe, expect, it } from 'vitest';
import { failureOf } from '../../src/monitor/upgradeText';
import type { SourceResult } from '../../src/sources/types';

const row = { source: 'rutracker' } as SourceResult;

describe('failureOf', () => {
  it('keeps a login failure as a sign-in prompt', () => {
    const f = failureOf({ ok: false, error: 'x', cause: 'login' }, row);
    expect(f.source).toBe('rutracker');
    expect(f.text).toContain('нужен вход');
    expect(f.text).toContain('не тронута');
  });

  it('says a missing torrent file is the tracker, without a sign-in button', () => {
    const f = failureOf({ ok: false, error: 'x', cause: 'link' }, row);
    expect(f.source).toBeUndefined();
    expect(f.text).toContain('не отдал файл раздачи');
    expect(f.text).toContain('другую раздачу');
    expect(f.text).not.toContain('нужен вход');
  });
});
