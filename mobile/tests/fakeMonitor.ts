// A fake of the monitoring part of the OmpNative plugin (mobile/src/monitor/native.ts), installed per test.
import { vi, type Mock } from 'vitest';
import { monitorNative, type MonitorStatus, type NotifyPermission } from '../src/monitor/native';
import type { MonitorSummary } from '../../src/monitor/settings';

export interface FakeMonitor {
  schedule: Mock<(o: { enabled: boolean; hours: number; wifiOnly: boolean }) => Promise<void>>;
  runNow: Mock<() => Promise<void>>;
  requestNotifyPermission: Mock<() => Promise<NotifyPermission>>;
  status: MonitorStatus | null;
  permission: NotifyPermission;
  openUrl: string | null;
  /** Fires the plugin's monitorDone event. */
  done(summary: MonitorSummary | null): void;
  /** Fires the plugin's monitorOpen event. */
  open(url: string): void;
  restore(): void;
}

export function fakeMonitor(): FakeMonitor {
  const was = monitorNative.available;
  monitorNative.available = true;
  const doneCbs: ((s: MonitorSummary | null) => void)[] = [];
  const openCbs: ((u: string) => void)[] = [];
  const f: FakeMonitor = {
    schedule: vi.fn(async (_o: { enabled: boolean; hours: number; wifiOnly: boolean }) => {}),
    runNow: vi.fn(async () => {}),
    requestNotifyPermission: vi.fn(async (): Promise<NotifyPermission> => {
      f.permission = 'granted';
      return 'granted';
    }),
    status: null,
    permission: 'prompt',
    openUrl: null,
    done: (s) => doneCbs.slice().forEach((cb) => cb(s)),
    open: (u) => openCbs.slice().forEach((cb) => cb(u)),
    restore: () => {
      monitorNative.available = was;
    },
  };
  vi.spyOn(monitorNative, 'schedule').mockImplementation((o) => f.schedule(o));
  vi.spyOn(monitorNative, 'runNow').mockImplementation(() => f.runNow());
  vi.spyOn(monitorNative, 'status').mockImplementation(async () => f.status);
  vi.spyOn(monitorNative, 'notifyPermission').mockImplementation(async () => f.permission);
  vi.spyOn(monitorNative, 'requestNotifyPermission').mockImplementation(() => f.requestNotifyPermission());
  vi.spyOn(monitorNative, 'takeOpen').mockImplementation(async () => {
    const u = f.openUrl;
    f.openUrl = null;
    return u;
  });
  vi.spyOn(monitorNative, 'onDone').mockImplementation((cb) => {
    doneCbs.push(cb);
    return () => {
      const i = doneCbs.indexOf(cb);
      if (i >= 0) doneCbs.splice(i, 1);
    };
  });
  vi.spyOn(monitorNative, 'onOpen').mockImplementation((cb) => {
    openCbs.push(cb);
    return () => {
      const i = openCbs.indexOf(cb);
      if (i >= 0) openCbs.splice(i, 1);
    };
  });
  return f;
}
