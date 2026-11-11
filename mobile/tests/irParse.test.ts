import { describe, expect, it } from 'vitest';
import { addLearned, deleteLearned, renameLearned } from '../src/tv/power/irProfile';
import { brandSignal, necFrame, sircFrame } from '../src/tv/power/irCodes';
import { parseFlipper, parseIrText, parseLearnerBody, parsePronto, parseRaw } from '../src/tv/power/irParse';

const FLIPPER = [
  'Filetype: IR signals file',
  'Version: 1',
  'name: Power',
  'type: raw',
  'frequency: 38000',
  'duty_cycle: 0.330000',
  'data: 9000 4500 560',
  'name: Vol',
  'type: raw',
  'frequency: 38000',
  'duty_cycle: 0.33',
  'data: 100 200',
].join('\n');

describe('IR text', () => {
  it('parses a Pronto hex code into carrier and microsecond pulses', () => {
    expect(parsePronto('0000 006D 0001 0000 000D 0050')).toEqual({ frequency: 38029, pulses: [342, 2104] });
    expect(parsePronto('garbage')).toBeNull();
    expect(parsePronto('0000 006D')).toBeNull();
  });

  it('parses raw timings with an optional carrier', () => {
    expect(parseRaw('38000 9000 -4500 560')).toEqual({ frequency: 38000, pulses: [9000, 4500, 560] });
    expect(parseRaw('9000, 4500, 560')).toEqual({ frequency: 38000, pulses: [9000, 4500, 560] });
    expect(parseRaw('1 2')).toBeNull();
  });

  it('parses a Flipper .ir file, including a parsed NEC button', () => {
    expect(parseFlipper(FLIPPER)).toEqual([
      { name: 'Power', frequency: 38000, pulses: [9000, 4500, 560] },
      { name: 'Vol', frequency: 38000, pulses: [100, 200] },
    ]);
    const nec = [
      'name: Pwr',
      'type: parsed',
      'protocol: NEC',
      'address: 04 00 00 00',
      'command: 08 00 00 00',
    ].join('\n');
    const parsed = parseFlipper(nec);
    if (!parsed) throw new Error('flipper');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Pwr');
    expect(parsed[0].pulses).toEqual(necFrame(0x04, 0x08).pulses);
  });

  it('picks the format from pasted text', () => {
    expect(parseIrText(FLIPPER)).toHaveLength(2);
    expect(parseIrText('0000 006D 0001 0000 000D 0050')).toEqual([{ name: '', frequency: 38029, pulses: [342, 2104] }]);
    expect(parseIrText('not a code')).toBeNull();
  });

  it('accepts a learner capture and rejects a broken one', () => {
    expect(parseLearnerBody({ frequency: 38000, pulses: [9000, 4500] })).toEqual({ frequency: 38000, pulses: [9000, 4500] });
    expect(parseLearnerBody({ frequency: 0, pulses: [100, 200] })).toEqual({ frequency: 0, pulses: [100, 200] });
    expect(parseLearnerBody({ pulses: [] })).toBeNull();
    expect(parseLearnerBody({ frequency: 38000, pulses: [1, 2.5] })).toBeNull();
    expect(parseLearnerBody({ frequency: 38000, pulses: Array(600).fill(100) })).toBeNull();
  });
});

describe('IR encoders', () => {
  it('encodes a standard NEC frame, least significant bit first', () => {
    const f = necFrame(0x04, 0x08);
    expect(f.frequency).toBe(38000);
    const bit = (one: boolean) => (one ? [560, 1690] : [560, 560]);
    // 0x04, ~0x04 (0xFB), 0x08, ~0x08 (0xF7), each LSB first
    const bits = [0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1];
    const pulses = [9000, 4500].concat(...bits.map((b) => bit(b === 1))).concat([560]);
    expect(f.pulses).toEqual(pulses);
  });

  it('encodes Sony SIRC-12', () => {
    const f = sircFrame(21, 1);
    expect(f.frequency).toBe(40000);
    expect(f.pulses.slice(0, 6)).toEqual([2400, 600, 1200, 600, 600, 600]);
  });

  it('builds brand buttons with the encoder, not a copied timing dump', () => {
    const lg = brandSignal('lg', 'power', 0);
    const samsung = brandSignal('samsung', 'power', 0);
    const sony = brandSignal('sony', 'power', 0);
    if (!lg || !samsung || !sony) throw new Error('brand');
    expect(lg.pulses).toEqual(necFrame(0x04, 0x08).pulses);
    expect(samsung.frequency).toBe(38000);
    expect(sony.frequency).toBe(40000);
    expect(brandSignal('lg', 'power', 9)).toBeNull();
    expect(brandSignal('nope', 'power', 0)).toBeNull();
  });
});

describe('learned buttons', () => {
  const signal = { frequency: 38000, pulses: [1, 2, 3] };

  it('saves, renames and deletes a button on one device', () => {
    const added = addLearned([], 'aa:bb:cc:dd:ee:ff', { id: 'b1', name: 'Power', ...signal });
    expect(added).toEqual([{ deviceId: 'aa:bb:cc:dd:ee:ff', buttons: [{ id: 'b1', name: 'Power', ...signal }] }]);
    const renamed = renameLearned(added, 'aa:bb:cc:dd:ee:ff', 'b1', '  Питание  ');
    expect(renamed[0].buttons[0].name).toBe('Питание');
    const other = addLearned(renamed, '11:22:33:44:55:66', { id: 'b2', name: 'Ok', ...signal });
    expect(deleteLearned(other, 'aa:bb:cc:dd:ee:ff', 'b1')).toEqual([
      { deviceId: '11:22:33:44:55:66', buttons: [{ id: 'b2', name: 'Ok', ...signal }] },
    ]);
  });

  it('replaces a button that is learned again', () => {
    const once = addLearned([], 'd', { id: 'b1', name: 'Power', ...signal });
    const twice = addLearned(once, 'd', { id: 'b1', name: 'Power', frequency: 36000, pulses: [9] });
    expect(twice[0].buttons).toEqual([{ id: 'b1', name: 'Power', frequency: 36000, pulses: [9] }]);
  });
});
