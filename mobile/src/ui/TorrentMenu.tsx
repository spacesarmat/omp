import { useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { TorrentRenameSheet } from './TorrentRenameSheet';
import { showToast } from './toast';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { filesOf } from '../watch';
import { deleteTorrents, reportDeleted, watchTarget } from '../lib/torrentActions';
import { client } from '../../../src/store/servers';
import { torrents, refreshTorrents } from '../../../src/store/library';
import { renameTorrent } from '../../../src/lib/renameTorrent';
import { displayTitle } from '../../../src/lib/torrentName';
import { shortTitle } from '../../../src/lib/libraryView';
import { playableFiles } from '../../../src/lib/episodes';
import type { Torrent } from '../../../src/api/types';

const OPEN = 'M9 6l6 6-6 6';
const TV_PLAY = 'M3 5h18v11H3zM8 20h8M10 8.5l4 2.5-4 2.5z';
const PENCIL = 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4';
const CHECK = 'M5 12.5l4.5 4.5L19 7';
const TRASH = 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3';

/**
 * One more item of the menu, before «Удалить»: `run` resolves false when it did nothing (a confirm declined) and the
 * menu stays open; otherwise the menu closes once it ends.
 */
export interface TorrentMenuItem {
  label: string;
  icon: string;
  danger?: boolean;
  run: () => Promise<boolean>;
}

/**
 * What a long press on a torrent in «Мои» (and on a release of the series screen) opens: open, watch on the TV, rename,
 * select (without `onSelect`: none), the `extra` items, delete.
 */
export function TorrentMenu({
  tor,
  onClose,
  onSelect,
  onWatchTv,
  extra,
  heading,
}: {
  tor: Torrent;
  /** The sheet's title when the short title does not tell the release apart («Повелитель духов · 4K WEB-DL»). */
  heading?: string;
  onClose: () => void;
  onSelect?: (hash: string) => void;
  /** Runs the launch outside the menu (it closes at once), so its toast and the jump to the remote survive. */
  onWatchTv?: (tor: Torrent) => void;
  extra?: TorrentMenuItem[];
}) {
  const tv = activeTv.value;
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = displayTitle(tor);

  const open = () => {
    onClose();
    navigate({ name: 'torrent', hash: tor.hash });
  };

  // the same target as the card's main button; no playable file: nothing to start
  const canWatch = !!watchTarget(tor.hash, playableFiles(filesOf(tor)));
  const watch = () => {
    onClose();
    onWatchTv?.(tor);
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

  const runExtra = async (item: TorrentMenuItem) => {
    if (busy) return;
    setBusy(true);
    let done = false;
    try {
      done = await item.run();
    } finally {
      setBusy(false);
    }
    if (done) onClose();
  };

  if (renaming) return <TorrentRenameSheet initial={title} onSave={rename} onClose={() => { setRenaming(false); onClose(); }} />;

  return (
    <Sheet label={heading || shortTitle(title)} onClose={onClose}>
      <div class="m-sheet-title">{heading || shortTitle(title)}</div>
      <button type="button" class="m-opt" disabled={busy} onClick={open}>
        <Icon d={OPEN} size={22} />
        <span class="m-opt-name">{t('common.open')}</span>
      </button>
      {tv && onWatchTv && (
        <button type="button" class="m-opt" disabled={busy || !canWatch} onClick={watch}>
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
          <span class="m-opt-name">{t('library.select')}</span>
        </button>
      )}
      {(extra || []).map((item) => (
        <button key={item.label} type="button" class={'m-opt' + (item.danger ? ' m-danger' : '')} disabled={busy} onClick={() => void runExtra(item)}>
          <Icon d={item.icon} size={22} />
          <span class="m-opt-name">{item.label}</span>
        </button>
      ))}
      <button type="button" class="m-opt m-danger" disabled={busy} onClick={() => void remove()}>
        <Icon d={TRASH} size={22} />
        <span class="m-opt-name">{t('common.delete')}</span>
      </button>
    </Sheet>
  );
}
