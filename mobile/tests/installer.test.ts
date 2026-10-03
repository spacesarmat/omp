import { describe, it, expect } from 'vitest';
import {
  createInstallerNative,
  createProgress,
  errorText,
  hbcErrorText,
  reminderAt,
  InstallError,
  type InstallerPlugin,
} from '../src/install/installer';

function fakePlugin(o: { result?: Record<string, unknown>; error?: unknown; events?: Record<string, unknown>[] } = {}) {
  const calls: any[] = [];
  let removed = 0;
  const reminders: any[] = [];
  let cb: ((e: Record<string, unknown>) => void) | null = null;
  const plugin: InstallerPlugin = {
    async installStart(args) {
      calls.push(args);
      for (const e of o.events || []) cb?.(e);
      if (o.error) throw o.error;
      return o.result || { version: '0.14.0' };
    },
    async installCancel() {
      calls.push('cancel');
    },
    async devModeReminder(a) {
      reminders.push(a);
    },
    async addListener(_event, fn) {
      cb = fn;
      return { remove: async () => void removed++ };
    },
  };
  return { plugin, calls, reminders, removed: () => removed };
}

describe('installer native wrapper', () => {
  it('passes the request, forwards well-formed events and parses the result', async () => {
    const f = fakePlugin({
      events: [
        { phase: 'download', item: 'omp', percent: 42.4, version: '0.14.0' },
        { phase: 'bogus', item: 'omp' },
        { phase: 'upload', item: 'x', percent: 250 },
      ],
      result: { version: '0.14.0', hbcVersion: '0.7.3', hbcError: '', sdkInt: 30, abi: 'arm64-v8a', extra: 1 },
    });
    const events: any[] = [];
    const n = createInstallerNative(f.plugin);
    const r = await n.start({ method: 'lg-devmode', ip: '192.168.1.5', passphrase: 'A1B2C3', withHbc: true }, (e) => events.push(e));
    expect(f.calls[0]).toEqual({ method: 'lg-devmode', ip: '192.168.1.5', passphrase: 'A1B2C3', withHbc: true });
    expect(events).toEqual([
      { phase: 'download', item: 'omp', percent: 42, version: '0.14.0' },
      { phase: 'upload', item: 'omp', percent: 100 },
    ]);
    expect(r).toEqual({ version: '0.14.0', hbcVersion: '0.7.3', sdkInt: 30, abi: 'arm64-v8a' });
    expect(f.removed()).toBe(1);
  });

  it('Android TV requests carry no passphrase', async () => {
    const f = fakePlugin();
    await createInstallerNative(f.plugin).start({ method: 'atv-adb', ip: '192.168.1.9' }, () => {});
    expect(f.calls[0]).toEqual({ method: 'atv-adb', ip: '192.168.1.9' });
  });

  it('rejections become InstallError with the plugin code', async () => {
    const f = fakePlugin({ error: { code: 'wrong-passphrase', message: 'wrong-passphrase' } });
    const err = await createInstallerNative(f.plugin).start({ method: 'lg-devmode', ip: '192.168.1.5', passphrase: 'x' }, () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(InstallError);
    expect(err.code).toBe('wrong-passphrase');
    expect(f.removed()).toBe(1);
    const odd = await createInstallerNative(fakePlugin({ error: new Error('Что-то сломалось') }).plugin)
      .start({ method: 'atv-adb', ip: '192.168.1.9' }, () => {})
      .catch((e) => e);
    expect(odd.code).toBe('unknown');
  });

  it('cancel and the reminder go to the plugin; without it start fails and cancel is a no-op', async () => {
    const f = fakePlugin();
    const n = createInstallerNative(f.plugin);
    await n.cancel();
    await n.reminder(123);
    await n.reminder(null);
    expect(f.calls).toEqual(['cancel']);
    expect(f.reminders).toEqual([{ at: 123 }, { at: null }]);
    const none = createInstallerNative(null);
    expect(none.available).toBe(false);
    await expect(none.start({ method: 'atv-adb', ip: '192.168.1.9' }, () => {})).rejects.toThrow('Доступно только в приложении Android');
    await expect(none.cancel()).resolves.toBeUndefined();
  });
});

describe('progress', () => {
  it('LG with Homebrew Channel: one bar that never goes back', () => {
    const p = createProgress('lg-devmode', true);
    const seq = [
      p({ phase: 'connect', item: 'omp' }),
      p({ phase: 'download', item: 'omp', percent: 0 }),
      p({ phase: 'download', item: 'omp', percent: 100, version: '0.14.0' }),
      p({ phase: 'verify', item: 'omp' }),
      p({ phase: 'download', item: 'hbc', percent: 50 }),
      p({ phase: 'connect', item: 'omp', version: '0.14.0' }),
      p({ phase: 'upload', item: 'omp', percent: 100 }),
      p({ phase: 'install', item: 'omp' }),
      p({ phase: 'upload', item: 'hbc', percent: 100 }),
      p({ phase: 'install', item: 'hbc' }),
    ];
    const pct = seq.map((v) => v.percent);
    expect(pct).toEqual([...pct].sort((a, b) => a - b));
    expect(pct[0]).toBe(0);
    expect(pct[pct.length - 1]).toBeLessThan(100);
    expect(seq[0].text).toBe('Проверяю код на телевизоре');
    expect(seq[0].title).toBe('Устанавливаю OMP');
    expect(seq[2].title).toBe('Устанавливаю OMP 0.14.0');
    expect(seq[4].text).toBe('Скачиваю Homebrew Channel с GitHub · 50%');
    expect(seq[5].text).toBe('Скачано с GitHub, проверено · подключаюсь к телевизору');
    expect(seq[6].text).toBe('Скачано с GitHub, проверено · передаю на телевизор');
    expect(seq[8].text).toBe('Homebrew Channel · передаю на телевизор');
    expect(seq[9].text).toBe('Телевизор устанавливает Homebrew Channel');
  });

  it('Android TV: connect first, then download, upload and install', () => {
    const p = createProgress('atv-adb', false);
    expect(p({ phase: 'connect', item: 'omp' }).text).toBe('Подключаюсь к телевизору');
    expect(p({ phase: 'download', item: 'omp', percent: 100 }).percent).toBe(50);
    const up = p({ phase: 'upload', item: 'omp', percent: 50 });
    expect(up.percent).toBe(72);
    // a late lower event does not move the bar back
    expect(p({ phase: 'download', item: 'omp', percent: 10 }).percent).toBe(72);
    expect(p({ phase: 'install', item: 'omp' }).text).toBe('Телевизор устанавливает OMP');
  });
});

describe('texts', () => {
  it('every code has a Russian next step; unknown codes get a generic one', () => {
    for (const c of ['network', 'checksum', 'key-server', 'wrong-passphrase', 'ssh-closed', 'ssh-auth', 'low-space', 'adb-closed', 'unauthorized', 'timeout']) {
      expect(errorText(c)).not.toBe(errorText('???'));
    }
    expect(errorText('???')).toBe('Не удалось установить OMP. Повторите попытку.');
    expect(errorText('key-server')).toContain('Key Server');
    expect(errorText('ssh-closed')).toContain('Dev Mode Status');
    expect(errorText('unauthorized')).toContain('«Разрешить»');
    expect(hbcErrorText('checksum')).toContain('проверку');
  });

  it('reminder: 3 days before the 1000 hours run out', () => {
    expect(reminderAt(0)).toBe(928 * 3600 * 1000);
  });
});
