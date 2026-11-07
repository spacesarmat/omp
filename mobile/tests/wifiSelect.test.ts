import { describe, it, expect, beforeEach } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import {
  credentialsFor,
  dedupeHosts,
  dismissWifiPrompt,
  emptyWifiPrefs,
  resetWifiDismiss,
  type KnownServer,
  type WifiPrefs,
} from '../src/servers/wifiSelect';
import { cancelWifiRun, considerWifi, laterWifi, resetWifiScan, type WifiRunDeps } from '../src/servers/wifiRun';

const home: KnownServer = { id: 'home', url: 'http://10.0.0.2:8090', name: 'Home', user: 'me', password: 'secret' };
const primary: KnownServer = { id: 'main', url: 'http://10.0.0.5:8090', name: 'Main' };

function prefs(over: Partial<WifiPrefs> = {}): WifiPrefs {
  return { ...emptyWifiPrefs(), primaryId: 'main', ...over };
}

function deps(over: Partial<WifiRunDeps> = {}): WifiRunDeps & { applied: string[]; scanned: number } {
  const bag = { applied: [] as string[], scanned: 0 };
  const d: WifiRunDeps = {
    hint: async () => ({ available: true, ssid: 'Home' }),
    prefs: () => prefs(),
    save: () => undefined,
    saved: () => [home, primary],
    playback: () => false,
    echo: async () => true,
    discover: async () => {
      bag.scanned++;
      return [];
    },
    apply: (id) => bag.applied.push(id),
    ...over,
  };
  return Object.assign(d, bag);
}

beforeEach(() => {
  resetWifiDismiss();
  resetWifiScan();
  localStorage.clear();
});

describe('phone Wi-Fi TorrServer choice', () => {
  it('does not mention the TV link', () => {
    const src = readFileSync('mobile/src/servers/wifiRun.ts', 'utf8') + readFileSync('mobile/src/servers/wifiSelect.ts', 'utf8') + readFileSync('mobile/src/main.tsx', 'utf8');
    expect(src).not.toContain('phoneLink');
    expect(src).not.toContain('tsp.phoneLink');
  });

  it('a healthy saved profile is used and discovery is skipped', async () => {
    const d = deps({
      prefs: () => prefs({ profiles: [{ id: 'p', ssid: 'home', serverId: 'home', host: '10.0.0.2:8090' }] }),
    });
    const plan = await considerWifi(d);
    expect(plan).toEqual({ kind: 'use', serverId: 'home', reason: 'profile' });
    expect(d.scanned).toBe(0);
    expect(d.applied).toEqual(['home']);
  });

  it('the first find asks and does not switch; a password is not copied to that host', async () => {
    localStorage.setItem('tsp.phoneLink', '{"tv":"keep"}');
    const d = deps({
      discover: async () => [{ url: 'http://10.0.0.9:8090/', name: 'other' }, { url: 'http://10.0.0.9:8090', name: 'dup' }],
    });
    const plan = await considerWifi(d);
    expect(plan.kind).toBe('confirm');
    if (plan.kind === 'confirm') expect(dedupeHosts(plan.hosts)).toHaveLength(1);
    expect(d.applied).toEqual([]);
    expect(credentialsFor(home, 'http://10.0.0.9:8090')).toEqual({});
    expect(credentialsFor(home, home.url).password).toBe('secret');
    expect(localStorage.getItem('tsp.phoneLink')).toBe('{"tv":"keep"}');
  });

  it('several new servers open a chooser and do not switch', async () => {
    const d = deps({
      discover: async () => [{ url: 'http://10.0.0.8:8090' }, { url: 'http://10.0.0.9:8090' }],
    });
    const plan = await considerWifi(d);
    expect(plan.kind).toBe('choose');
    expect(d.applied).toEqual([]);
  });

  it('an unhealthy profile falls back to the primary when nothing else answers', async () => {
    const d = deps({
      prefs: () => prefs({ profiles: [{ id: 'p', ssid: 'home', serverId: 'home', host: '10.0.0.2:8090' }] }),
      echo: async () => false,
      discover: async () => [],
    });
    const plan = await considerWifi(d);
    expect(plan).toEqual({ kind: 'fallback', serverId: 'main', reason: 'unhealthy' });
    expect(d.applied).toEqual(['main']);
  });

  it('no hint and no typed name does not scan or switch', async () => {
    let scanned = 0;
    const d = deps({
      hint: async () => ({ available: false, ssid: null }),
      prefs: () => prefs({ manualSsid: '' }),
      discover: async () => {
        scanned++;
        return [{ url: 'http://10.0.0.9:8090' }];
      },
    });
    expect(await considerWifi(d)).toEqual({ kind: 'skip', reason: 'no-hint' });
    expect(scanned).toBe(0);
    expect(d.applied).toEqual([]);
  });

  it('a typed name is the hint when the platform cannot read one', async () => {
    const d = deps({
      hint: async () => ({ available: false, ssid: null }),
      prefs: () => prefs({ manualSsid: 'Cafe' }),
      discover: async () => [{ url: 'http://10.0.0.9:8090' }],
    });
    const plan = await considerWifi(d);
    expect(plan.kind).toBe('confirm');
    if (plan.kind === 'confirm') expect(plan.ssid).toBe('cafe');
  });

  it('playback freezes the choice, including a flip during discovery', async () => {
    const quiet = deps({ playback: () => true });
    expect(await considerWifi(quiet)).toEqual({ kind: 'defer', reason: 'playback' });
    expect(quiet.applied).toEqual([]);

    let play = false;
    let applied = 0;
    const plan = await considerWifi(deps({
      playback: () => play,
      discover: async () => {
        play = true;
        return [{ url: 'http://10.0.0.9:8090' }];
      },
      apply: () => applied++,
    }));
    expect(plan).toEqual({ kind: 'defer', reason: 'playback' });
    expect(applied).toBe(0);
  });

  it('cancelling the scan drops the result', async () => {
    let applied = 0;
    const plan = await considerWifi(deps({
      discover: async (cancel) => {
        cancelWifiRun();
        expect(cancel()).toBe(true);
        return [{ url: 'http://10.0.0.9:8090' }];
      },
      apply: () => applied++,
    }));
    expect(plan.kind).toBe('defer');
    expect(applied).toBe(0);
  });

  it('not now hides that find for this session and then uses the primary', async () => {
    const found = [{ url: 'http://10.0.0.9:8090', name: 'other' }];
    const first = await considerWifi(deps({ discover: async () => found }));
    expect(first.kind).toBe('confirm');
    if (first.kind === 'confirm') laterWifi(first);
    dismissWifiPrompt('home', found[0].url);
    resetWifiScan();
    const second = await considerWifi(deps({ discover: async () => found }));
    expect(second).toEqual({ kind: 'fallback', serverId: 'main', reason: 'none' });
  });

  it('disabled and a manual override do not discover', async () => {
    let scanned = 0;
    const off = deps({
      prefs: () => prefs({ enabled: false }),
      discover: async () => {
        scanned++;
        return [];
      },
    });
    expect((await considerWifi(off)).kind).toBe('skip');
    const locked = deps({
      prefs: () => prefs({ overrideId: 'main' }),
      discover: async () => {
        scanned++;
        return [];
      },
    });
    expect(await considerWifi(locked)).toEqual({ kind: 'use', serverId: 'main', reason: 'override' });
    expect(scanned).toBe(0);
  });
});
