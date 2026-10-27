// «Другая раздача» of a series season or a film in «Мои»: its releases in the library, the one shown checked; a tap
// shows that one instead. «Найти другую раздачу» goes on to the search for a better one.
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { t } from '../../../src/i18n';
import { displayTitle } from '../../../src/lib/torrentName';
import { shortTitle } from '../../../src/lib/libraryView';
import { knownSwarmText } from '../../../src/lib/torrentStatus';
import type { Torrent } from '../../../src/api/types';
import { releaseLine } from '../lib/duplicates';

const CHECK = 'M5 12.5l4.5 4.5L19 7';
const MORE = 'M5 12h.01M12 12h.01M19 12h.01';

export function ReleasesSheet({
  releases,
  current,
  onPick,
  onFind,
  onClose,
}: {
  releases: Torrent[];
  /** The hash shown now. */
  current: string;
  onPick: (tor: Torrent) => void;
  /** «Найти другую раздачу»; omitted when there is nothing to search with. */
  onFind?: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet label={t('nav.releasesTitle')} testId="PD55" onClose={onClose}>
      <div class="m-sheet-title">{t('nav.releasesTitle')}</div>
      <div class="m-sub-pick m-releases" role="radiogroup" aria-label={t('nav.releasesTitle')}>
        {releases.map((tor) => {
          const on = tor.hash === current;
          const swarm = knownSwarmText(tor);
          return (
            <button
              key={tor.hash}
              type="button"
              role="radio"
              aria-checked={on}
              class="m-opt"
              data-release={tor.hash}
              onClick={() => {
                onClose();
                if (!on) onPick(tor);
              }}
            >
              <span class="m-opt-text m-grow">
                <span class="m-opt-name">{releaseLine(tor)}</span>
                <span class="m-opt-sub">{[shortTitle(displayTitle(tor)), swarm].filter(Boolean).join(' · ')}</span>
              </span>
              {on && <Icon d={CHECK} size={22} />}
            </button>
          );
        })}
      </div>
      {onFind && (
        <button
          type="button"
          class="m-btn m-btn-secondary tm"
          data-code="PD55.1"
          onClick={() => {
            onClose();
            onFind();
          }}
        >
          {t('nav.releasesFind')}
        </button>
      )}
    </Sheet>
  );
}

/** «Раздача: 1080p WEB-DL · 18 ГБ · Сменить»: the release shown, and the way to «Другая раздача». */
export function ReleaseSwitch({ tor, code, onChange, onMore }: { tor: Torrent; code: string; onChange: () => void; onMore?: () => void }) {
  const line = releaseLine(tor, false);
  return (
    <div class="m-release-switch tm" data-release-switch data-hash={tor.hash} data-code={code}>
      <span class="m-small m-release-switch-text">
        {t('nav.release') + ': '}
        <b>{line}</b>
      </span>
      <button type="button" class="m-btn-text" aria-haspopup="dialog" aria-label={t('nav.releaseChangeAria', { name: line })} onClick={onChange}>
        {t('nav.releaseChange')}
      </button>
      {onMore && (
        <button type="button" class="m-icon-btn m-release-more" aria-label={t('library.actions')} onClick={onMore}>
          <Icon d={MORE} size={20} />
        </button>
      )}
    </div>
  );
}
