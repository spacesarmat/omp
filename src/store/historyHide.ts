// Phone: «Убрать из истории» hides a show from «Продолжить» and the history list on this device.
import { loadJson, saveJson } from './storage';

const KEY = 'tsp.historyHide';

function read(): string[] {
  const v = loadJson<unknown>(KEY, [], (x) => x instanceof Array);
  return (v as unknown[]).filter((x) => typeof x === 'string') as string[];
}

export function hiddenHistory(): string[] {
  return read();
}

export function hideHistory(id: string): void {
  const cur = read();
  if (cur.indexOf(id) >= 0) return;
  saveJson(KEY, cur.concat(id));
}

export function isHistoryHidden(id: string, hidden: string[] = read()): boolean {
  return hidden.indexOf(id) >= 0;
}
