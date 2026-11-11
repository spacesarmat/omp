// Compact IR commands. Timings are produced by the encoders below from published
// protocol command numbers (NEC, NEC-32, SIRC). This file is original OMP code
// under GPL-3.0. It is not a copy of IRDB or Flipper-IRDB: those collections
// mix licenses, including GPL-2-only LIRC dumps, so their timing files are not
// vendored. "Проверить код" exists because a command number can miss a model.

export interface IrSignal {
  frequency: number;
  pulses: number[];
}

export type IrButton = 'power' | 'volUp' | 'volDown' | 'input';

/** Standard NEC: 38 kHz, address, inverted address, command, inverted command, LSB first. */
export function necFrame(address: number, command: number): IrSignal {
  const pulses = [9000, 4500];
  const push = (b: number) => {
    for (let i = 0; i < 8; i++) pulses.push(560, ((b >> i) & 1) === 1 ? 1690 : 560);
  };
  push(address & 255);
  push(~address & 255);
  push(command & 255);
  push(~command & 255);
  pulses.push(560);
  return { frequency: 38000, pulses };
}

/** 32-bit NEC word, LSB first. Samsung TVs use this shape (the address is not inverted). */
export function nec32(word: number): IrSignal {
  const pulses = [9000, 4500];
  for (let i = 0; i < 32; i++) pulses.push(560, ((word >>> i) & 1) === 1 ? 1690 : 560);
  pulses.push(560);
  return { frequency: 38000, pulses };
}

/** Sony SIRC-12: 40 kHz, 7 command bits then 5 address bits, LSB first. */
export function sircFrame(command: number, address: number): IrSignal {
  const pulses = [2400, 600];
  const bit = (one: boolean) => pulses.push(one ? 1200 : 600, 600);
  for (let i = 0; i < 7; i++) bit(((command >> i) & 1) === 1);
  for (let i = 0; i < 5; i++) bit(((address >> i) & 1) === 1);
  return { frequency: 40000, pulses };
}

interface Brand {
  id: string;
  power: IrSignal[];
  volUp: IrSignal[];
  volDown: IrSignal[];
  input: IrSignal[];
}

function necBrand(id: string, address: number, cmd: { power: number[]; volUp: number[]; volDown: number[]; input: number[] }): Brand {
  const map = (ns: number[]) => ns.map((n) => necFrame(address, n));
  return { id, power: map(cmd.power), volUp: map(cmd.volUp), volDown: map(cmd.volDown), input: map(cmd.input) };
}

const BRANDS: Brand[] = [
  necBrand('lg', 0x04, { power: [0x08], volUp: [0x02], volDown: [0x03], input: [0x0b] }),
  {
    id: 'samsung',
    power: [nec32(0xe0e040bf)],
    volUp: [nec32(0xe0e0e01f)],
    volDown: [nec32(0xe0e0d02f)],
    input: [nec32(0xe0e0807f)],
  },
  {
    id: 'sony',
    power: [sircFrame(21, 1)],
    volUp: [sircFrame(18, 1)],
    volDown: [sircFrame(19, 1)],
    input: [sircFrame(37, 1)],
  },
  necBrand('philips', 0x00, { power: [0x0c], volUp: [0x10], volDown: [0x11], input: [0x38] }),
  necBrand('panasonic', 0x40, { power: [0x3d], volUp: [0x20], volDown: [0x21], input: [0x35] }),
];

export const IR_BRAND_IDS = BRANDS.map((b) => b.id);

/** One candidate for a brand button. Null when the brand or the index does not exist. */
export function brandSignal(brand: string, button: IrButton, index: number): IrSignal | null {
  const found = BRANDS.filter((b) => b.id === brand)[0];
  if (!found) return null;
  const list = found[button];
  return list[index] || null;
}
