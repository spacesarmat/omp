import { loadJson, saveJson } from '../store/storage';

const KEY = 'omp.progressWriterSeq';
let last = 0;

export function nextProgressWriteSeq(): number {
  const stored = loadJson<number>(KEY, 0, (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);
  const next = Math.max(Date.now() * 1000, last + 1, stored + 1);
  last = next;
  saveJson(KEY, next);
  return next;
}
