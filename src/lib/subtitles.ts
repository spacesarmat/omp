export interface Cue {
  start: number;
  end: number;
  text: string;
}

export function parseTime(s: string): number {
  const parts = s.trim().replace(',', '.').split(':');
  let sec = 0;
  for (let i = 0; i < parts.length; i++) sec = sec * 60 + parseFloat(parts[i]);
  return Math.round(sec * 1000) / 1000;
}

function cleanText(t: string): string {
  return t.replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim();
}

export function parseSrt(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, '').replace(/\r/g, '').split(/\n[ \t]*\n/);
  const cues: Cue[] = [];
  blocks.forEach((block) => {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.indexOf('-->') >= 0);
    if (ti < 0) return;
    const m = /([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[ti]);
    if (!m) return;
    const body = cleanText(lines.slice(ti + 1).join('\n'));
    if (!body) return;
    cues.push({ start: parseTime(m[1]), end: parseTime(m[2]), text: body });
  });
  return cues.sort((a, b) => a.start - b.start);
}

export function parseAss(text: string): Cue[] {
  const lines = text.replace(/\r/g, '').split('\n');
  let inEvents = false;
  let fields: string[] = [];
  const cues: Cue[] = [];
  lines.forEach((line) => {
    const l = line.trim();
    if (/^\[.*\]$/.test(l)) {
      inEvents = l.toLowerCase() === '[events]';
      return;
    }
    if (!inEvents) return;
    if (l.indexOf('Format:') === 0) {
      fields = l.slice(7).split(',').map((x) => x.trim().toLowerCase());
      return;
    }
    if (l.indexOf('Dialogue:') !== 0 || !fields.length) return;
    const rest = l.slice(9).replace(/^\s+/, '');
    const values: string[] = [];
    let cur = rest;
    for (let i = 0; i < fields.length - 1; i++) {
      const c = cur.indexOf(',');
      if (c < 0) return;
      values.push(cur.slice(0, c));
      cur = cur.slice(c + 1);
    }
    values.push(cur);
    const get = (name: string) => values[fields.indexOf(name)];
    const raw = get('text') || '';
    const body = raw.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim();
    if (!body) return;
    cues.push({ start: parseTime(get('start')), end: parseTime(get('end')), text: body });
  });
  return cues.sort((a, b) => a.start - b.start);
}

export function parseSubtitles(text: string, ext: string): Cue[] {
  const e = ext.toLowerCase();
  return e === 'ass' || e === 'ssa' ? parseAss(text) : parseSrt(text);
}

export function cueAt(cues: Cue[], t: number): string {
  const active: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.start > t) break;
    if (t < c.end) active.push(c.text);
  }
  return active.join('\n');
}

export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch (e) {
    return new TextDecoder('windows-1251').decode(buf);
  }
}
