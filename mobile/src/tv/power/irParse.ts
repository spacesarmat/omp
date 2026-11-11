// Parsers for pasted IR: raw timings, Pronto hex, Flipper .ir, and the learner's JSON.
import { necFrame, type IrSignal } from './irCodes';

export interface NamedSignal extends IrSignal {
  name: string;
}

const MAX_PULSES = 512;

function pulsesOk(frequency: number, pulses: number[]): IrSignal | null {
  if (!Number.isInteger(frequency) || (frequency !== 0 && (frequency < 20000 || frequency > 60000))) return null;
  if (pulses.length < 2 || pulses.length > MAX_PULSES) return null;
  if (pulses.some((n) => !Number.isInteger(n) || n < 20 || n > 200000)) return null;
  return { frequency, pulses };
}

/** Pronto learned code: frequency from word 1, then burst words as microseconds. */
export function parsePronto(text: string): IrSignal | null {
  const words = text.trim().split(/\s+/).map((w) => parseInt(w, 16));
  if (words.length < 6 || words.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  if (words[0] !== 0 || words[1] <= 0) return null;
  const pairs = words[2] + words[3];
  if (pairs <= 0 || words.length < 4 + pairs * 2) return null;
  const freqCode = words[1];
  const pulses: number[] = [];
  for (let i = 0; i < pairs * 2; i++) pulses.push(Math.round(words[4 + i] * freqCode * 0.241246));
  const frequency = Math.round(1000000 / (freqCode * 0.241246));
  return pulsesOk(frequency, pulses);
}

/** "38000 9000 -4500 560" or "9000, 4500, 560" (38 kHz when the carrier is omitted). */
export function parseRaw(text: string): IrSignal | null {
  const parts = text.trim().split(/[\s,]+/).filter((s) => s.length > 0);
  if (!parts.length) return null;
  const nums = parts.map((s) => Number(s.replace(/^\+/, '')));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const abs = nums.map((n) => Math.abs(Math.trunc(n)));
  let frequency = 38000;
  let pulses = abs;
  if (abs[0] >= 20000 && abs[0] <= 60000) {
    frequency = abs[0];
    pulses = abs.slice(1);
  }
  return pulsesOk(frequency, pulses);
}

function hexByte(s: string | undefined): number | null {
  if (!s) return null;
  const word = s.trim().split(/\s+/)[0] || '';
  const n = parseInt(word.replace(/^0x/i, ''), 16);
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
}

/** Flipper Zero `.ir` text. A broken button is skipped. Null when nothing usable remains. */
export function parseFlipper(text: string): NamedSignal[] | null {
  const blocks: { [k: string]: string }[] = [];
  let cur: { [k: string]: string } | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(lines[i].trim());
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'name') {
      if (cur) blocks.push(cur);
      cur = { name: m[2].trim() };
    } else if (cur) {
      cur[key] = m[2].trim();
    }
  }
  if (cur) blocks.push(cur);
  const out: NamedSignal[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if ((b.type || '').toLowerCase() === 'raw' && b.data) {
      const pulses = b.data.split(/\s+/).map((n) => Number(n));
      const frequency = b.frequency ? Number(b.frequency) : 38000;
      const signal = pulses.every((n) => Number.isFinite(n)) ? pulsesOk(frequency, pulses.map((n) => Math.trunc(Math.abs(n)))) : null;
      if (signal) out.push({ name: b.name || '', ...signal });
    } else if ((b.type || '').toLowerCase() === 'parsed' && (b.protocol || '').toUpperCase() === 'NEC') {
      const address = hexByte(b.address);
      const command = hexByte(b.command);
      if (address === null || command === null) continue;
      out.push({ name: b.name || '', ...necFrame(address, command) });
    }
  }
  return out.length ? out : null;
}

/** One capture from the ESP learner: `{ frequency, pulses }`. Frequency 0 means the carrier was not measured. */
export function parseLearnerBody(v: unknown): IrSignal | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { frequency?: unknown; pulses?: unknown };
  if (typeof o.frequency !== 'number' || !Array.isArray(o.pulses)) return null;
  const pulses: number[] = [];
  for (let i = 0; i < o.pulses.length; i++) {
    const n = o.pulses[i];
    if (typeof n !== 'number' || !Number.isInteger(n)) return null;
    pulses.push(n);
  }
  return pulsesOk(o.frequency, pulses);
}

/** Paste or a file: Flipper, Pronto, then raw. */
export function parseIrText(text: string): NamedSignal[] | null {
  const t = text.trim();
  if (!t) return null;
  if (/^Filetype:\s*IR/im.test(t) || /^name:/im.test(t)) return parseFlipper(t);
  if (/^0000\b/i.test(t)) {
    const p = parsePronto(t);
    return p ? [{ name: '', ...p }] : null;
  }
  const raw = parseRaw(t);
  return raw ? [{ name: '', ...raw }] : null;
}
