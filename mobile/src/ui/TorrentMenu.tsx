import { useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { LaunchError } from './LaunchError';
import { TorrentRenameSheet } from './TorrentRenameSheet';
import { showToast } from './toast';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { filesOf, useTvLaunch } from '../watch';
import { deleteTorrents, reportDeleted } from '../lib/torrentActions';
import { client } from '../../../src/store/servers';
import { torrents, refreshTorrents } from '../../../src/store/library';
import { continueWatching, getLocalProgress, resumePosition } from '../../../src/store/progress';
import { renameTorrent } from '../../../src/lib/renameTorrent';
import { displayTitle } from '../../../src/lib/torrentName';
import { shortTitle } from '../../../src/lib/libraryView';
import { baseName, episodeLabel, playableFiles, stripExt } from '../../../src/lib/episodes';
import type { Torrent } from '../../../src/api/types';

const OPEN = 'M9 6l6 6-6 6';
const TV_PLAY = 'M3 5h18v11H3zM8 20h8M10 8.5l4 2.5-4 2.5z';
const PENCIL = 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4';
const CHECK = 'M5 12.5l4.5 4.5L19 7';
const TRASH = 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3';

/** What a long press on a torrent in «Мои» opens: open, watch on the TV, rename, select, delete. */
export function TorrentMenu({ tor, onClose, onSelect }: { tor: Torrent; onClose: () => void; onSelect?: (hash: string) => void }) {
  const tv = activeTv.value;
  const launch = useTvLaunch();
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = displayTitle(tor);

  const open = () => {
    onClose();
    navigate({ name: 'torrent', hash: tor.hash });
  };

  // the same target as the card's main button: the latest started file, else the first one
  const watch = async () => {
    const files = playableFiles(filesOf(tor));
    const last = continueWatching(torrents.value, 1000).find((e) => e.torrent.hash === tor.hash);
    const target = (last && files.find((f) => f.id === last.fileIndex)) || files[0];
    const id = target ? target.id : 1;
    setError('');
    await launch.start({
      hash: tor.hash,
      file: id,
      at: resumePosition(tor.hash, id),
      duration: getLocalProgress(tor.hash, id)?.duration || undefined,
      label: [target ? episodeLabel(target.path) : '', target ? stripExt(baseName(target.path)) : title].filter(Boolean).join(' · '),
      onBusy: setBusy,
      onError: setError,
      onLaunched: () => onClose(),
    });
  };

  const rename = (raw: string) => {
    const c = client.value;
    if (!c) return Promise.reject(new Error(t('common.retry')));
    return renameTorrent(c, tor, raw).then((saved) => {
      torrents.value = torrents.value.map((x) => (x.hash === tor.hash ? { ...x, title: saved } : x));
      showToast(t('torrent.screen.renamed'));
      void refreshTorrents(c).catch(() => {});
    });
  };

  const remove = async () => {
    const c = client.value;
    if (!c || busy) return;
    if (!window.confirm(t('torrent.screen.deleteAsk', { title: shortTitle(title) }))) return;
    setBusy(true);
    const r = await deleteTorrents(c, [tor.hash]);
    reportDeleted(r);
    onClose();
  };

  if (renaming) return <TorrentRenameSheet initial={title} onSave={rename} onClose={() => { setRenaming(false); onClose(); }} />;

  return (
    <Sheet label={shortTitle(title)} onClose={onClose}>
      <div class="m-sheet-title">{shortTitle(title)}</div>
      <button type="button" class="m-opt" disabled={busy} onClick={open}>
        <Icon d={OPEN} size={22} />
        <span class="m-opt-name">{t('common.open')}</span>
      </button>
      {tv && (
        <button type="button" class="m-opt" disabled={busy} onClick={() => void watch()}>
          <Icon d={TV_PLAY} size={22} />
          <span class="m-opt-name">{t('news.watchOnTv')}</span>
        </button>
      )}
      <button type="button" class="m-opt" disabled={busy} onClick={() => setRenaming(true)}>
        <Icon d={PENCIL} size={22} />
        <span class="m-opt-name">{t('torrent.rename.title')}</span>
      </button>
      {onSelect && (
        <button
          type="button"
          class="m-opt"
          disabled={busy}
          onClick={() => {
            onClose();
            onSelect(tor.hash);
          }}
        >
          <Icon d={CHECK} size={22} />
          <span class="m-opt-name">{t('settings.choose')}</span>
        </button>
      )}
      <button type="button" class="m-opt m-danger" disabled={busy} onClick={() => void remove()}>
        <Icon d={TRASH} size={22} />
        <span class="m-opt-name">{t('common.delete')}</span>
      </button>
      {error && <LaunchError message={error} class="m-status-err" />}
      {launch.sheet}
    </Sheet>
  );
}
