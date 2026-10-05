import { Sheet } from './Sheet';
import { t, tp } from '../../../src/i18n';
import { loadJson, saveJson } from '../../../src/store/storage';
import { NO_FILTERS, sanitizeFilters, type SearchFilters, type Res, type Source, type Voice } from '../../../src/sources/filters';

const KEY = 'tsp.searchFilters';

export function loadSearchFilters(): SearchFilters {
  return sanitizeFilters(loadJson<unknown>(KEY, null));
}

export function saveSearchFilters(f: SearchFilters): void {
  saveJson(KEY, f);
}

function toggle<T>(list: T[], v: T): T[] {
  return list.indexOf(v) >= 0 ? list.filter((x) => x !== v) : list.concat(v);
}

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" class={'m-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );
}

/** «Фильтры» of the search results: quality, source, size, seeds, voice-over, seasons. */
export function FiltersSheet({
  value,
  seasons,
  onChange,
  onClose,
  count,
}: {
  value: SearchFilters;
  seasons: number[];
  onChange: (f: SearchFilters) => void;
  onClose: () => void;
  count: number;
}) {
  const f = value;
  const set = (patch: Partial<SearchFilters>) => onChange({ ...f, ...patch });
  const res: [Res, string][] = [[720, '720p'], [1080, '1080p'], [2160, '4K']];
  const src: [Source, string][] = [['web', 'WEB-DL'], ['bdrip', 'BDRip'], ['remux', 'Remux']];
  const voices: [Voice, string][] = [['dub', t('filters.dubChip')], ['mvo', t('filters.mvoChip')], ['original', t('filters.originalChip')]];
  const gb = (v: string) => {
    const n = parseFloat(v.replace(',', '.'));
    return isFinite(n) && n > 0 ? n : 0;
  };
  return (
    <Sheet label={t('filters.title')} onClose={onClose}>
      <div class="m-sheet-head">
        <div class="m-sheet-title">{t('filters.title')}</div>
        <button type="button" class="m-link-btn" onClick={() => onChange(NO_FILTERS)}>{t('common.reset')}</button>
      </div>
      <div class="m-sheet-scroll m-filters">
        <div class="m-filter-group">
          <span class="m-filter-label">{t('monitor.sub.quality')}</span>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            {res.map(([r, l]) => <Chip key={r} on={f.res.indexOf(r) >= 0} label={l} onClick={() => set({ res: toggle(f.res, r) })} />)}
            <Chip on={f.hdr} label={t('filters.hdrDv')} onClick={() => set({ hdr: !f.hdr })} />
          </div>
        </div>
        <div class="m-filter-group">
          <span class="m-filter-label">{t('add.source')}</span>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            {src.map(([s, l]) => <Chip key={s} on={f.source.indexOf(s) >= 0} label={l} onClick={() => set({ source: toggle(f.source, s) })} />)}
            <Chip on={f.hideCam} label={t('filters.hideCam')} onClick={() => set({ hideCam: !f.hideCam })} />
          </div>
        </div>
        <div class="m-filter-group">
          <span class="m-filter-label">{t('filters.sizeGb')}</span>
          <div class="m-filter-size">
            <label>
              {t('filters.from')}
              <input inputMode="decimal" value={f.minGb ? String(f.minGb) : ''} placeholder="0" onInput={(e) => set({ minGb: gb((e.target as HTMLInputElement).value) })} />
            </label>
            <label>
              {t('filters.to')}
              <input inputMode="decimal" value={f.maxGb ? String(f.maxGb) : ''} placeholder={t('filters.unlimited')} onInput={(e) => set({ maxGb: gb((e.target as HTMLInputElement).value) })} />
            </label>
          </div>
        </div>
        <div class="m-filter-group">
          <span class="m-filter-label">{t('filters.minSeeds')}</span>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            {[0, 1, 5, 20].map((n) => <Chip key={n} on={f.minSeeds === n} label={n ? String(n) : t('filters.anySeeds')} onClick={() => set({ minSeeds: n })} />)}
          </div>
        </div>
        <div class="m-filter-group">
          <span class="m-filter-label">{t('filters.voice')}</span>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            {voices.map(([v, l]) => <Chip key={v} on={f.voice.indexOf(v) >= 0} label={l} onClick={() => set({ voice: toggle(f.voice, v) })} />)}
            <Chip on={f.rusSubs} label={t('filters.rusSubsChip')} onClick={() => set({ rusSubs: !f.rusSubs })} />
          </div>
        </div>
        {(seasons.length > 0 || f.season > 0) && (
          <div class="m-filter-group">
            <span class="m-filter-label">{t('category.tv')}</span>
            <div class="m-chips" style={{ flexWrap: 'wrap' }}>
              {seasons.map((s) => <Chip key={s} on={f.season === s} label={t('library.season', { n: s })} onClick={() => set({ season: f.season === s ? 0 : s })} />)}
              <Chip on={f.fullSeason} label={t('filters.fullSeasonOnly')} onClick={() => set({ fullSeason: !f.fullSeason })} />
            </div>
          </div>
        )}
      </div>
      <button type="button" class="m-btn m-btn-primary" onClick={onClose}>
        {tp('filters.show', count)}
      </button>
    </Sheet>
  );
}
