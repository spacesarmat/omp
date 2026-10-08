import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BOX,
  BOX_KEYCODES,
  BoxError,
  boxActive,
  boxError,
  boxKeyCode,
  boxState,
  boxVia,
  cancelBoxCode,
  connectBox,
  createBoxNative,
  disableBox,
  enableBox,
  sendBoxKey,
  setBoxNative,
  submitBoxCode,
  syncBox,
  transportOrder,
  type BoxNative,
} from '../src/tv/boxRemote';
import { reloadTvs, saveTv, tvs, sanitizeTvs } from '../src/tv/tvStore';
import { cleanBoxCode } from '../src/ui/BoxCodeSheet';

const IP = '192.168.1.106';

function fake(over: Partial<BoxNative> = {}) {
  const closed: ((v: 'google' | 'adb') => void)[] = [];
  const n: any = {
    available: true,
    probe: vi.fn().mockResolvedValue({ google: true, adb: true }),
    connect: vi.fn().mockImplementation((_ip: string, v: 'google' | 'adb') => Promise.resolve(v)),
    pairStart: vi.fn().mockResolvedValue(undefined),
    pairFinish: vi.fn().mockResolvedValue('google'),
    pairCancel: vi.fn().mockResolvedValue(undefined),
    key: vi.fn().mockResolvedValue(undefined),
    text: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onClosed: vi.fn((cb: (v: 'google' | 'adb') => void) => {
      closed.push(cb);
      return () => {};
    }),
    ...over,
  };
  return { n, close: (v: 'google' | 'adb') => closed.forEach((c) => c(v)) };
}

const tv = () => tvs.value.find((x) => x.ip === IP)!;

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  saveTv({ ip: IP, name: 'Dune HD', kind: 'atv', token: 'a'.repeat(32) });
});

afterEach(() => setBoxNative(null));

describe('box keys', () => {
  it('maps the remote buttons to Android KeyEvent codes', () => {
    expect(boxKeyCode('UP')).toBe(19);
    expect(boxKeyCode('DOWN')).toBe(20);
    expect(boxKeyCode('LEFT')).toBe(21);
    expect(boxKeyCode('RIGHT')).toBe(22);
    expect(boxKeyCode('ENTER')).toBe(23);
    expect(boxKeyCode('BACK')).toBe(4);
    expect(boxKeyCode('HOME')).toBe(3);
    expect(boxKeyCode('MENU')).toBe(82);
    expect(boxKeyCode('SETTINGS')).toBe(176);
    expect(boxKeyCode('VOLUMEUP')).toBe(24);
    expect(boxKeyCode('VOLUMEDOWN')).toBe(25);
    expect(boxKeyCode('MUTE')).toBe(164);
    expect(boxKeyCode('PLAYPAUSE')).toBe(85);
    expect(boxKeyCode('NEXT')).toBe(87);
    expect(boxKeyCode('PREV')).toBe(88);
    expect([boxKeyCode('RED'), boxKeyCode('GREEN'), boxKeyCode('YELLOW'), boxKeyCode('BLUE')]).toEqual([183, 184, 185, 186]);
    // OMP-only keys and unknown names are not box keys
    expect(boxKeyCode('CATALOG')).toBeNull();
    expect(boxKeyCode('toString')).toBeNull();
    for (const c of Object.values(BOX_KEYCODES)) expect(c > 0 && c <= 400).toBe(true);
  });

  it('the pairing code keeps 6 hex characters, upper case', () => {
    expect(cleanBoxCode(' a1-b2 c3x9 ')).toBe('A1B2C3');
    expect(cleanBoxCode('zz')).toBe('');
  });
});

describe('transport selection', () => {
  it('prefers the one that worked, then Google, then adb; only what answers', () => {
    expect(transportOrder(undefined, { google: true, adb: true })).toEqual(['google', 'adb']);
    expect(transportOrder('adb', { google: true, adb: true })).toEqual(['adb', 'google']);
    expect(transportOrder('google', { google: false, adb: true })).toEqual(['adb']);
    expect(transportOrder(undefined, { google: false, adb: false })).toEqual([]);
  });
});

describe('native wrapper', () => {
  it('turns plugin rejections into BoxError with the code and a text', async () => {
    const plugin: any = {
      boxProbe: vi.fn().mockResolvedValue({ google: true, adb: 'yes', via: 'adb' }),
      boxConnect: vi.fn().mockRejectedValue(Object.assign(new Error('box-adb-closed'), { code: 'box-adb-closed' })),
      boxPairFinish: vi.fn().mockRejectedValue(new Error('box-bad-code')),
      boxKey: vi.fn().mockRejectedValue(new Error('weird')),
      boxText: vi.fn().mockResolvedValue({ typed: true }),
      addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    };
    const n = createBoxNative(plugin);
    expect(await n.probe(IP)).toEqual({ google: true, adb: false, via: 'adb' });
    await expect(n.connect(IP, 'adb')).rejects.toMatchObject({ code: BOX.ADB_CLOSED, message: 'Отладка по сети на приставке выключена' });
    await expect(n.pairFinish(IP, 'ABCDEF')).rejects.toMatchObject({ code: BOX.BAD_CODE });
    await expect(n.key(3, false)).rejects.toMatchObject({ code: BOX.FAILED });
    expect(plugin.boxKey).toHaveBeenCalledWith({ code: 3, long: false });
    expect(await n.text('hi')).toBe(true);
    expect(createBoxNative(null).available).toBe(false);
  });
});

describe('box flow', () => {
  it('turning the switch on connects Google TV Remote when the box knows the phone and remembers it', async () => {
    const { n } = fake();
    setBoxNative(n);
    await enableBox(tv());
    expect(n.connect).toHaveBeenCalledWith(IP, 'google');
    expect(boxState.value).toBe('connected');
    expect(boxVia.value).toBe('google');
    expect(tv().box).toEqual({ on: true, via: 'google' });
    expect(boxActive(tv())).toBe(true);
    // the setting survives a reload
    expect(sanitizeTvs(JSON.parse(localStorage.getItem('tsp.tvs')!))[0].box).toEqual({ on: true, via: 'google' });
  });

  it('an unknown phone: the TV shows a code, a wrong code keeps the entry, the right one connects', async () => {
    const { n } = fake({
      connect: vi.fn().mockRejectedValue(new BoxError(BOX.NEED_PAIRING)),
      pairFinish: vi.fn().mockRejectedValueOnce(new BoxError(BOX.BAD_CODE)).mockResolvedValueOnce('google'),
    });
    setBoxNative(n);
    await enableBox(tv());
    expect(n.pairStart).toHaveBeenCalledWith(IP);
    expect(boxState.value).toBe('code');
    await expect(submitBoxCode(tv(), 'a1 b2c3')).rejects.toMatchObject({ code: BOX.BAD_CODE, message: 'Код неверный — проверьте код на экране телевизора' });
    expect(n.pairFinish).toHaveBeenCalledWith(IP, 'A1B2C3');
    expect(boxState.value).toBe('code');
    await submitBoxCode(tv(), 'A1B2C4');
    expect(boxState.value).toBe('connected');
    expect(tv().box).toEqual({ on: true, via: 'google' });
  });

  it('reconnecting on its own never shows a code: it says pairing is needed', async () => {
    const { n } = fake({ connect: vi.fn().mockRejectedValue(new BoxError(BOX.NEED_PAIRING)) });
    setBoxNative(n);
    saveTv({ ...tv(), box: { on: true, via: 'google' } });
    await connectBox(tv());
    expect(n.pairStart).not.toHaveBeenCalled();
    expect(boxState.value).toBe('error');
    expect(boxError.value).toContain('не знает этот телефон');
  });

  it('no Google service: adb, the TV is asked to allow debugging', async () => {
    let resolve!: (v: 'adb') => void;
    const { n } = fake({
      probe: vi.fn().mockResolvedValue({ google: false, adb: true }),
      connect: vi.fn().mockImplementation(() => new Promise((r) => (resolve = r))),
    });
    setBoxNative(n);
    const p = enableBox(tv());
    await vi.waitFor(() => expect(n.connect).toHaveBeenCalledWith(IP, 'adb'));
    expect(boxState.value).toBe('confirm');
    resolve('adb');
    await p;
    expect(boxState.value).toBe('connected');
    expect(tv().box).toEqual({ on: true, via: 'adb' });
  });

  it('nothing answers: explains how to turn on network debugging', async () => {
    const { n } = fake({ probe: vi.fn().mockResolvedValue({ google: false, adb: false }) });
    setBoxNative(n);
    await enableBox(tv());
    expect(boxState.value).toBe('adbHelp');
    expect(n.connect).not.toHaveBeenCalled();
  });

  it('declined on the TV: says so and does not try another way', async () => {
    const { n } = fake({
      probe: vi.fn().mockResolvedValue({ google: true, adb: true }),
      connect: vi.fn().mockImplementation((_ip: string, v: string) => Promise.reject(new BoxError(v === 'adb' ? BOX.REJECTED : BOX.FAILED))),
    });
    setBoxNative(n);
    saveTv({ ...tv(), box: { on: true, via: 'adb' } });
    await connectBox(tv(), { setup: true });
    expect(n.connect).toHaveBeenCalledTimes(1);
    expect(boxState.value).toBe('error');
    expect(boxError.value).toBe('Подключение отклонено на телевизоре');
  });

  it('Google fails for another reason: falls back to adb', async () => {
    const { n } = fake({
      connect: vi.fn().mockImplementation((_ip: string, v: 'google' | 'adb') => (v === 'google' ? Promise.reject(new BoxError(BOX.FAILED)) : Promise.resolve(v))),
    });
    setBoxNative(n);
    await enableBox(tv());
    expect(n.connect.mock.calls.map((c: unknown[]) => c[1])).toEqual(['google', 'adb']);
    expect(boxVia.value).toBe('adb');
  });

  it('keys go through the box; a dropped channel reconnects once and the key is sent again', async () => {
    const { n, close } = fake();
    setBoxNative(n);
    await enableBox(tv());
    await sendBoxKey(tv(), 'HOME');
    expect(n.key).toHaveBeenLastCalledWith(3, false);
    close('google');
    expect(boxState.value).toBe('idle');
    await sendBoxKey(tv(), 'VOLUMEUP', true);
    expect(n.connect).toHaveBeenCalledTimes(2);
    expect(n.key).toHaveBeenLastCalledWith(24, true);
    n.key.mockRejectedValueOnce(new BoxError(BOX.NOT_CONNECTED));
    await sendBoxKey(tv(), 'BACK');
    expect(n.connect).toHaveBeenCalledTimes(3);
    expect(n.key).toHaveBeenLastCalledWith(4, false);
  });

  it('the switch off closes the channel and keeps the transport; sync reconnects a switched-on box', async () => {
    const { n } = fake();
    setBoxNative(n);
    await enableBox(tv());
    disableBox(tv());
    expect(n.disconnect).toHaveBeenCalled();
    expect(boxState.value).toBe('off');
    expect(tv().box).toEqual({ on: false, via: 'google' });
    syncBox(tv());
    expect(n.probe).toHaveBeenCalledTimes(1);
    saveTv({ ...tv(), box: { on: true, via: 'google' } });
    syncBox(tv());
    await vi.waitFor(() => expect(boxState.value).toBe('connected'));
    expect(n.probe).toHaveBeenCalledTimes(2);
  });

  it('cancelling the code entry stops pairing', async () => {
    const { n } = fake({ connect: vi.fn().mockRejectedValue(new BoxError(BOX.NEED_PAIRING)) });
    setBoxNative(n);
    await enableBox(tv());
    cancelBoxCode();
    expect(n.pairCancel).toHaveBeenCalled();
    expect(boxState.value).toBe('idle');
  });
});
