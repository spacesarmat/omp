import { useRef, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import type { FoundOmpTv, FoundTv } from '../platform/native';
import { CodeSheet } from './CodeSheet';
import { Icon } from './Icon';
import { activeTv, saveTv, setActiveTv, type SavedTv } from '../tv/tvStore';
import { connectTv, pairAtv } from '../tv/tvClient';
import { ensureFoundTvScan, foundTvNoWifi, foundTvRows, foundTvScanning, noteFoundTvScreen } from '../tv/foundTvDiscovery';

export { setFoundTvDiscoverer } from '../tv/foundTvDiscovery';

let connectFound: ((tv: SavedTv) => void) | null = null;

export function setFoundTvConnect(fn: ((tv: SavedTv) => void) | null): void {
  connectFound = fn;
}

/**
 * TVs the shared discovery store already sees, with one tap to connect. «Каталог», «Пульт» and
 * «Настройки» read one scan: a TV found on one screen is already listed on the next, and a result
 * that arrives later updates every open list. Opening a screen searches again when that scan is
 * empty, older than its TTL, or from another network. While a scan is still running and nothing is
 * known yet, a searching line stands in for the empty block. Nothing is rendered once the scan ends
 * with no TV, so a network with no TV stays as it was. Without Wi-Fi there is no scan and no line.
 * `quiet` («Каталог»): no searching line at all, so the posters below do not jump while a scan runs
 * and a tap lands where the user aimed; found TVs still appear.
 */
export function FoundTvs({ quiet = false }: { quiet?: boolean } = {}) {
  const [coding, setCoding] = useState<FoundOmpTv | null>(null);
  // a TV chosen while this was open: the list was for the empty state
  const chosen = activeTv.value;
  // once per mount, before paint: a re-render after the scan settles is not another open
  const opened = useRef(false);
  if (!opened.current) {
    opened.current = true;
    noteFoundTvScreen();
  }
  if (!chosen) ensureFoundTvScan();
  const rows = foundTvRows.value;
  const scanning = foundTvScanning.value && !foundTvNoWifi.value;

  function connectLg(f: FoundTv) {
    const tv: SavedTv = { ip: f.ip, name: f.name || 'LG ' + f.ip, kind: 'lg' };
    saveTv(tv);
    setActiveTv(f.ip);
    if (connectFound) connectFound(tv);
    else void connectTv(tv);
  }

  if (chosen || (!rows.length && (!scanning || quiet) && !coding)) return null;
  return (
    <div class="m-found-tvs">
      {scanning && !quiet && rows.length === 0 && (
        <div class="m-muted m-searching" role="status">
          <svg class="m-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F5B700" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
          {t('remote.foundTvsSearching')}
        </div>
      )}
      {rows.length > 0 && <div class="m-set-label">{t('remote.foundTvs')}</div>}
      {rows.map((r) => (
        <button
          key={r.kind + ':' + r.ip}
          type="button"
          class="m-server"
          onClick={() => (r.kind === 'atv' && r.atv ? setCoding(r.atv) : r.lg && connectLg(r.lg))}
        >
          <Icon d="M3 5h18v11H3zM8 20h8" size={26} />
          <span class="m-server-text">
            <span class="m-server-name">{r.name}</span>
            <span class="m-muted m-small">{r.meta}</span>
          </span>
        </button>
      ))}
      {coding && (
        <CodeSheet
          tvName={coding.name}
          version={coding.version}
          onSubmit={async (code) => {
            await pairAtv(coding, code);
            setCoding(null);
          }}
          onCancel={() => setCoding(null)}
        />
      )}
    </div>
  );
}
