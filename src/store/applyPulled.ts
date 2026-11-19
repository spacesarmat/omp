// A pulled row has to land in the stores the screens already read.
import type { SyncRecord } from './syncMerge';
import { torrents } from './library';
import { parseData, sanitizeSkip, serializeData, withOmp, withQualityWatch, withReleaseMeta, withWatch, type JournalEntry, type SkipPrefs } from '../lib/journal';
import { applySyncedProgress } from './progress';
import { applySyncedMatch } from '../lib/seriesMatch';

function journalFile(row: SyncRecord): { f: number; src: 'tv' | 'phone' } | null {
  const src = row.body.src;
  if (typeof row.body.f === 'number' && (src === 'tv' || src === 'phone')) return { f: row.body.f, src };
  const parts = row.id.split(':');
  const tail = parts[parts.length - 1];
  const file = Number(parts[parts.length - 2]);
  if ((tail === 'tv' || tail === 'phone') && file >= 0) return { f: file, src: tail };
  return null;
}

function journalEntry(body: { [k: string]: unknown }): JournalEntry | null {
  if (typeof body.f !== 'number' || typeof body.at !== 'number') return null;
  if (body.src !== 'tv' && body.src !== 'phone') return null;
  const entry: JournalEntry = {
    f: body.f,
    t: typeof body.t === 'number' ? body.t : 0,
    d: typeof body.d === 'number' ? body.d : 0,
    at: body.at,
    src: body.src,
  };
  if (typeof body.name === 'string' && body.name) entry.name = body.name;
  return entry;
}

function latestOf(rows: SyncRecord[], kind: string): SyncRecord | null {
  let best: SyncRecord | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind !== kind) continue;
    if (!best || row.updatedAt >= best.updatedAt) best = row;
  }
  return best;
}

let parked: SyncRecord[] = [];
let applying = false;

function park(rows: SyncRecord[]): void {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === 'progress' || row.kind === 'match') continue;
    let found = false;
    for (let j = 0; j < parked.length; j++) {
      if (parked[j].id === row.id) {
        parked[j] = row;
        found = true;
        break;
      }
    }
    if (!found) parked.push(row);
  }
}

function applyLibrary(rows: SyncRecord[]): void {
  const list = torrents.value;
  if (!list.length) {
    park(rows);
    return;
  }
  let changed = false;
  const copy = list.slice();
  const seen: { [id: string]: boolean } = {};
  for (let i = 0; i < copy.length; i++) {
    const hash = (copy[i].hash || '').toLowerCase();
    const mine = rows.filter((r) => r.key === hash && r.kind !== 'progress' && r.kind !== 'match');
    if (!mine.length) continue;
    for (let j = 0; j < mine.length; j++) seen[mine[j].id] = true;
    const parsed = parseData(copy[i].data);
    if (!parsed) continue;
    let journal = parsed.journal.slice();
    let obj = parsed.obj;
    let skip: SkipPrefs | null | undefined = undefined;
    for (let j = 0; j < mine.length; j++) {
      const row = mine[j];
      if (row.kind !== 'journal') continue;
      const file = journalFile(row);
      if (file) journal = journal.filter((e) => !(e.f === file.f && e.src === file.src));
      if (!row.deleted) {
        const entry = journalEntry(row.body);
        if (entry) journal.push(entry);
      }
    }
    journal.sort((a, b) => b.at - a.at);
    const watch = latestOf(mine, 'watch');
    if (watch) obj = withWatch(obj, watch.deleted === true || watch.body.newEpisodes !== false);
    const quality = latestOf(mine, 'quality');
    if (quality) obj = withQualityWatch(obj, quality.deleted === true || quality.body.better !== false);
    const audio = latestOf(mine, 'audio');
    if (audio) obj = withOmp(obj, (omp) => { if (audio.deleted) delete omp.a; else omp.a = audio.body; });
    const title = latestOf(mine, 'title');
    if (title) {
      if (title.deleted) obj = withOmp(obj, (omp) => { delete omp.nm; delete omp.rt; });
      else obj = withReleaseMeta(obj, typeof title.body.raw === 'string' ? title.body.raw : '', title.body.locked === true);
    }
    const skipRow = latestOf(mine, 'skip');
    if (skipRow) skip = skipRow.deleted ? null : sanitizeSkip(skipRow.body);
    const data = serializeData(obj, journal, skip);
    let titleText = copy[i].title;
    if (title && !title.deleted && typeof title.body.title === 'string' && title.body.title) titleText = title.body.title;
    if (data !== copy[i].data || titleText !== copy[i].title) {
      copy[i] = { ...copy[i], data, title: titleText };
      changed = true;
    }
  }
  const left: SyncRecord[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind === 'progress' || rows[i].kind === 'match') continue;
    if (!seen[rows[i].id]) left.push(rows[i]);
  }
  park(left);
  if (changed) torrents.value = copy;
}

export function applyPulled(rows: SyncRecord[]): void {
  const progress = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === 'progress') progress.push(row);
    if (row.kind === 'match' && !row.deleted && typeof row.body.id === 'number') {
      applySyncedMatch(row.key, row.body.id, typeof row.body.q === 'string' ? row.body.q : '', row.updatedAt);
    }
  }
  applySyncedProgress(progress);
  applyLibrary(rows);
}

torrents.subscribe(() => {
  if (applying || !parked.length || !torrents.value.length) return;
  const rows = parked;
  parked = [];
  applying = true;
  applyLibrary(rows);
  applying = false;
});
