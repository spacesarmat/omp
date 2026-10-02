import { useState } from 'preact/hooks';
import { Icon, ICONS } from '../ui/Icon';
import { TracksSheet } from '../ui/TracksSheet';
import { goBack, navigate, switchTab } from '../nav';
import { activeTv } from '../tv/tvStore';
import { nowPlaying, linkStatus, sendCmd } from '../tv/playerLink';
import { volume as tvVolume } from '../tv/tvClient';
import { formatDuration } from '../../../src/lib/format';
import type { PlayerState } from '../../../src/phone/protocol';

const cssUrl = (u: string) => u.replace(/["()\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hasImage = (s: PlayerState) => /^https?:\/\//i.test(s.poster || '');

export function playerPosterStyle(s: PlayerState): string {
  const gradient = 'linear-gradient(160deg, #2B3A55, #151A26 80%)';
  return hasImage(s) ? `background: url("${cssUrl(s.poster || '')}") center / cover, ${gradient}` : `background: ${gradient}`;
}

function Skip({ label, text, d, onClick }: { label: string; text: string; d: string; onClick: () => void }) {
  return (
    <button type="button" class="m-now-skip" aria-label={label} onClick={onClick}>
      <Icon d={d} size={26} />
      {text}
    </button>
  );
}

export function NowPlaying({ volume = tvVolume }: { volume?: (dir: 'up' | 'down') => Promise<void> }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [tracks, setTracks] = useState(false);
  const s = nowPlaying.value;
  const status = linkStatus.value;
  const tv = activeTv.value;
  const vol = (dir: 'up' | 'down') => void Promise.resolve(volume(dir)).catch(() => {});

  const head = (
    <div class="m-now-head">
      <button type="button" class="m-icon-btn" aria-label="Свернуть" onClick={() => goBack()}>
        <Icon d={ICONS.collapse} />
      </button>
      <div class="m-now-status">
        <span class="m-now-kicker">СЕЙЧАС НА ТВ</span>
        {status === 'stale' ? (
          <span class="m-now-tv warn">Телевизор не отвечает</span>
        ) : (
          tv && <span class="m-now-tv">{tv.name}</span>
        )}
      </div>
      <button type="button" class="m-icon-btn" aria-label="Пульт" onClick={() => navigate({ name: 'remote' })}>
        <Icon d={ICONS.remote} />
      </button>
    </div>
  );

  if (!s || status === 'none') {
    return (
      <div class="m-screen m-now" data-route="nowPlaying">
        {head}
        <div class="m-now-empty">
          <div class="m-sheet-title">На телевизоре ничего не играет</div>
          <button type="button" class="m-btn m-btn-primary" onClick={() => switchTab({ name: 'library' })}>
            Открыть каталог
          </button>
        </div>
      </div>
    );
  }

  const shown = drag ?? s.time;
  const max = Math.max(1, s.duration);
  const pct = Math.max(0, Math.min(100, (shown / max) * 100));
  const left = s.duration > 0 ? '−' + formatDuration(Math.max(0, s.duration - shown)) : '';
  return (
    <div class="m-screen m-now" data-route="nowPlaying">
      {head}
      <div class="m-now-poster" style={playerPosterStyle(s)}>
        {!hasImage(s) && s.title}
      </div>
      <div class="m-now-titles">
        <div class="m-now-title">{s.title}</div>
        <div class="m-now-sub">{s.subtitle}</div>
      </div>
      <div class="m-now-seek">
        <div class="m-seek">
          <div class="m-seek-fill" style={{ width: pct + '%' }} />
          <input
            type="range"
            class="m-seek-input"
            aria-label="Перемотка"
            min={0}
            max={max}
            step={1}
            value={shown}
            onInput={(e) => setDrag(Number((e.currentTarget as HTMLInputElement).value))}
            onChange={(e) => {
              sendCmd({ type: 'seek', t: Number((e.currentTarget as HTMLInputElement).value) });
              setDrag(null);
            }}
          />
        </div>
        <div class="m-now-times">
          <span>{formatDuration(shown)}</span>
          <span>{left}</span>
        </div>
      </div>
      <div class="m-now-controls">
        <Skip label="Предыдущая серия" text="" d={ICONS.prev} onClick={() => sendCmd({ type: 'prev' })} />
        <Skip label="Назад на 10 секунд" text="10" d={ICONS.back10} onClick={() => sendCmd({ type: 'skip', d: -10 })} />
        <button
          type="button"
          class="m-now-play"
          aria-label={s.paused ? 'Играть' : 'Пауза'}
          onClick={() => sendCmd({ type: s.paused ? 'play' : 'pause' })}
        >
          <Icon d={s.paused ? ICONS.play : ICONS.pause} size={32} />
        </button>
        <Skip label="Вперёд на 10 секунд" text="10" d={ICONS.fwd10} onClick={() => sendCmd({ type: 'skip', d: 10 })} />
        <Skip label="Следующая серия" text="" d={ICONS.next} onClick={() => sendCmd({ type: 'next' })} />
      </div>
      <div class="m-now-row">
        <button type="button" class="m-now-wide" onClick={() => setTracks(true)}>
          <Icon d={ICONS.tracks} size={20} />
          Звук и субтитры
        </button>
        <div class="m-now-wide m-now-vol">
          <button type="button" aria-label="Громкость меньше" onClick={() => vol('down')}>
            −
          </button>
          <Icon d={ICONS.volume} size={20} />
          <button type="button" aria-label="Громкость больше" onClick={() => vol('up')}>
            +
          </button>
        </div>
      </div>
      {s.next && (
        <div class="m-now-next">
          <span>Дальше: {s.next.title}</span>
          <button type="button" onClick={() => sendCmd({ type: 'next' })}>
            Включить
          </button>
        </div>
      )}
      {tracks && (
        <TracksSheet
          state={s}
          onAudio={(i) => {
            sendCmd({ type: 'audio', i });
            setTracks(false);
          }}
          onSubs={(value) => {
            sendCmd({ type: 'subs', value });
            setTracks(false);
          }}
          onClose={() => setTracks(false)}
        />
      )}
    </div>
  );
}
