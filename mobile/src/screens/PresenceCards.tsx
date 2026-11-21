import { useEffect, useState } from 'preact/hooks';
import { fetchPresence, type PlaybackPresence } from '../../../src/billing/presenceClient';
import { deviceId } from '../../../src/billing/session';
import { syncEnabled } from '../../../src/store/deviceDb';
import { torrents } from '../../../src/store/library';
import type { Torrent } from '../../../src/api/types';
import type { TorrentFile } from '../../../src/lib/episodes';
import { formatDuration } from '../../../src/lib/format';
import { t } from '../../../src/i18n';
import { filesOf } from '../watch';
import { playOnPhone } from '../watchHere';
import { showToast } from '../ui/toast';

export interface PresenceCardActions {
  fetch: () => Promise<PlaybackPresence[]>;
  play: (tor: Torrent | string, file: TorrentFile, at?: number, total?: number) => Promise<void>;
}

const defaults: PresenceCardActions = { fetch: fetchPresence, play: playOnPhone };
let actions = defaults;

export function setPresenceCardActions(next: PresenceCardActions | null): void {
  actions = next || defaults;
}

export function visiblePresence(rows: PlaybackPresence[], self: string): PlaybackPresence[] {
  return rows.filter((row) => row.deviceId !== self).sort((a, b) => {
    if ((a.state === 'playing') !== (b.state === 'playing')) return a.state === 'playing' ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.deviceId.localeCompare(b.deviceId);
  });
}

export function presenceTarget(row: PlaybackPresence, library: Torrent[]): { torrent: Torrent; file: TorrentFile } | null {
  const hash = row.hash.toLowerCase();
  const torrent = library.find((item) => item.hash.toLowerCase() === hash);
  if (!torrent) return null;
  const file = filesOf(torrent).find((item) => item.id === row.fileId);
  return file ? { torrent, file } : null;
}

function stateLabel(row: PlaybackPresence): string {
  const device = row.deviceName || row.deviceId.slice(0, 8);
  if (row.state === 'playing') return t('settings.presencePlaying', { device });
  if (row.state === 'paused') return t('settings.presencePaused', { device });
  return t('settings.presenceFinished', { device });
}

export function PresenceCards() {
  const [rows, setRows] = useState<PlaybackPresence[]>([]);
  const [busy, setBusy] = useState('');
  const self = deviceId();

  useEffect(() => {
    if (!syncEnabled()) return;
    let alive = true;
    const load = () => {
      if (!alive || document.visibilityState !== 'visible') return;
      void actions.fetch().then((items) => {
        if (alive) setRows(visiblePresence(items, self));
      });
    };
    load();
    const interval = window.setInterval(load, 15000);
    document.addEventListener('visibilitychange', load);
    return () => {
      alive = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', load);
    };
  }, [self]);

  if (!rows.length) return null;
  return (
    <>
      {rows.map((row) => {
        const target = presenceTarget(row, torrents.value);
        const position = formatDuration(row.positionSec) + (row.durationSec > 0 ? ' / ' + formatDuration(row.durationSec) : '');
        return (
          <div class="m-set-row" data-presence-row={row.deviceId} key={row.deviceId}>
            <div class="m-set-text">
              <span>{stateLabel(row)}</span>
              <span>{[row.title, row.episode].filter(Boolean).join(' · ')}</span>
              <span class="m-muted m-small">{position}</span>
              {!target ? <span class="m-muted m-small">{t('settings.presenceUnavailable')}</span> : null}
            </div>
            {target ? (
              <button
                type="button"
                class="m-btn m-btn-secondary"
                data-presence-continue={row.deviceId}
                disabled={busy === row.deviceId}
                onClick={() => {
                  setBusy(row.deviceId);
                  void actions.play(target.torrent, target.file, row.positionSec, row.durationSec).then(
                    () => setBusy(''),
                    () => {
                      setBusy('');
                      showToast(t('settings.presenceUnavailable'));
                    },
                  );
                }}
              >{t('settings.presenceContinue')}</button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
