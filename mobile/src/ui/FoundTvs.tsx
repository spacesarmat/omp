import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { native, type FoundOmpTv, type FoundTv } from '../platform/native';
import { CodeSheet } from './CodeSheet';
import { Icon } from './Icon';
import { activeTv, saveTv, setActiveTv, type SavedTv } from '../tv/tvStore';
import { connectTv, pairAtv } from '../tv/tvClient';

const SEARCH_MS = 4000;

type LgDiscover = (ms: number) => Promise<FoundTv[]>;
type AtvDiscover = (ms: number) => Promise<FoundOmpTv[]>;

let lgDiscover: LgDiscover | null = null;
let atvDiscover: AtvDiscover | null = null;
let connectFound: ((tv: SavedTv) => void) | null = null;

/** Tests: discovery and the connect that follows a tap. Null restores the real ones. */
export function setFoundTvDiscoverer(lg: LgDiscover | null, atv: AtvDiscover | null = null): void {
  lgDiscover = lg;
  atvDiscover = atv;
}

export function setFoundTvConnect(fn: ((tv: SavedTv) => void) | null): void {
  connectFound = fn;
}

interface Row {
  ip: string;
  name: string;
  meta: string;
  kind: 'lg' | 'atv';
  lg?: FoundTv;
  atv?: FoundOmpTv;
}

/**
 * TVs discovery already sees, with one tap to connect. Renders nothing until a TV is found, so a screen
 * with no TV on the network stays as it was.
 */
export function FoundTvs() {
  const [rows, setRows] = useState<Row[]>([]);
  const [coding, setCoding] = useState<FoundOmpTv | null>(null);
  // a TV chosen while this was open: the list was for the empty state
  const chosen = activeTv.value;

  useEffect(() => {
    let alive = true;
    const lg = (lgDiscover ?? ((ms: number) => native.discoverTvs(ms)))(SEARCH_MS).catch(() => [] as FoundTv[]);
    const atv = (atvDiscover ?? ((ms: number) => native.discoverOmpTvs(ms)))(SEARCH_MS).catch(() => [] as FoundOmpTv[]);
    Promise.all([lg, atv]).then(([foundLg, foundAtv]) => {
      if (!alive) return;
      const next: Row[] = [];
      for (const f of foundAtv) {
        if (next.some((r) => r.ip === f.ip)) continue;
        next.push({ ip: f.ip, name: f.name, meta: f.ip + (f.version ? ' · OMP ' + f.version : ''), kind: 'atv', atv: f });
      }
      for (const f of foundLg) {
        if (next.some((r) => r.ip === f.ip)) continue;
        next.push({ ip: f.ip, name: f.name, meta: f.ip + (f.model ? ' · ' + f.model : ''), kind: 'lg', lg: f });
      }
      setRows(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  function connectLg(f: FoundTv) {
    const tv: SavedTv = { ip: f.ip, name: f.name || 'LG ' + f.ip, kind: 'lg' };
    saveTv(tv);
    setActiveTv(f.ip);
    if (connectFound) connectFound(tv);
    else void connectTv(tv);
  }

  if (chosen || (!rows.length && !coding)) return null;
  return (
    <div class="m-found-tvs">
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
