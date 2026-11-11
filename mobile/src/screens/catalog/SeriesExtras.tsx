// Skip and monitoring at the bottom of the phone series page. The torrent screen keeps its own blocks.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../../src/i18n';
import { Icon } from '../../ui/Icon';
import { showToast } from '../../ui/toast';
import { errorMessage } from '../../../../src/api/http';
import { client } from '../../../../src/store/servers';
import { useSkip, firstPlayableId } from '../../../../src/lib/useSkip';
import { loadWatch, loadQualityWatch, saveWatch, saveQualityWatch } from '../../../../src/store/journal';
import { isWatchedSeries } from '../../../../src/monitor/newEpisodes';
import { isLibraryFilm } from '../../../../src/monitor/better';
import type { Torrent } from '../../../../src/api/types';
import type { TorrentFile } from '../../../../src/lib/episodes';

const CHEVRON_UP = 'M6 14l6-6 6 6';
const CHEVRON_DOWN = 'M6 10l6 6 6-6';

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} class={'m-switch' + (on ? ' on' : '')} onClick={onToggle}>
      <span class="m-switch-knob" />
    </button>
  );
}

/** «Пропуск» and «Мониторинг» after the cast. No second «Найти в лучшем качестве». */
export function SeriesExtras({ tor, files }: { tor: Torrent; files: TorrentFile[] }) {
  const c = client.value;
  const skip = useSkip(c, tor.hash, firstPlayableId(files), true);
  const [open, setOpen] = useState(false);
  const [watchNew, setWatchNew] = useState<boolean | null>(null);
  const [watchQuality, setWatchQuality] = useState<boolean | null>(null);
  const series = isWatchedSeries({ hash: tor.hash, title: tor.title || '', category: tor.category, data: '', file_stats: files });
  const film = isLibraryFilm({ title: tor.title || '', category: tor.category });
  useEffect(() => {
    if (!c) return;
    let alive = true;
    loadWatch(c, tor.hash).then((v) => alive && setWatchNew(v), () => alive && setWatchNew(true));
    loadQualityWatch(c, tor.hash).then((v) => alive && setWatchQuality(v), () => alive && setWatchQuality(true));
    return () => {
      alive = false;
    };
  }, [c, tor.hash]);
  const onOff = (v: boolean) => t(v ? 'tvSources.on' : 'tvSources.off');
  const toggleSkip = (key: 'i' | 'c') => {
    skip.save((p) => (key === 'i' ? { i: !p.i } : { c: !p.c }), true).then(undefined, (e) => showToast(errorMessage(e)));
  };
  return (
    <div class="m-series-tail" data-series-tail>
      <div class="m-skip" data-block="skip">
        <button type="button" class="m-skip-row m-skip-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span class="m-skip-text">
            <span class="m-skip-title">{t('torrent.skip')}</span>
            <span class="m-muted m-small">
              {t('torrent.screen.skipSumIntro', { state: onOff(skip.prefs.i) })} · {t('torrent.screen.skipSumCredits', { state: onOff(skip.prefs.c) })}
            </span>
          </span>
          <Icon d={open ? CHEVRON_UP : CHEVRON_DOWN} size={20} />
        </button>
        {open && (
          <>
            <div class="m-skip-row">
              <span class="m-skip-text">{t('torrent.screen.skipIntroSwitch')}</span>
              <Switch on={skip.prefs.i} label={t('torrent.screen.skipIntroSwitch')} onToggle={() => toggleSkip('i')} />
            </div>
            <div class="m-skip-row">
              <span class="m-skip-text">{t('torrent.skipCreditsShort')}</span>
              <Switch on={skip.prefs.c} label={t('torrent.skipCreditsShort')} onToggle={() => toggleSkip('c')} />
            </div>
          </>
        )}
      </div>
      <div class="m-skip" data-block="monitoring">
        <div class="m-skip-head">
          <span class="m-skip-title">{t('monitor.title')}</span>
        </div>
        {series && (
          <div class="m-skip-row" data-block="watch-new">
            <span class="m-skip-text">{t('monitor.settings.episodes')}</span>
            <Switch
              on={watchNew !== false}
              label={t('monitor.settings.episodes')}
              onToggle={() => {
                if (!c || watchNew === null) return;
                const next = !watchNew;
                setWatchNew(next);
                saveWatch(c, tor, next).then(undefined, (e) => {
                  setWatchNew(!next);
                  showToast(errorMessage(e));
                });
              }}
            />
          </div>
        )}
        {film && (
          <div class="m-skip-row" data-block="watch-quality">
            <span class="m-skip-text">{t('torrent.screen.watchQuality')}</span>
            <Switch
              on={watchQuality !== false}
              label={t('torrent.screen.watchQuality')}
              onToggle={() => {
                if (!c || watchQuality === null) return;
                const next = !watchQuality;
                setWatchQuality(next);
                saveQualityWatch(c, tor, next).then(undefined, (e) => {
                  setWatchQuality(!next);
                  showToast(errorMessage(e));
                });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
