import { useEffect, useState } from 'preact/hooks';
import { Icon, ICONS } from '../ui/Icon';
import { TracksSheet } from '../ui/TracksSheet';
import { goBack, navigate, switchTab } from '../nav';
import { activeTv } from '../tv/tvStore';
import { nowPlaying, lastSeen, linkStatus, launching, sendCmd } from '../tv/playerLink';
import { volume as tvVolume } from '../tv/tvClient';
import { formatDuration } from '../../../src/lib/format';
import { displayTitle } from '../ui/displayTitle';
import { chapterIndexAt, chapterLabel, chapterStepIndex, type Chapter } from '../../../src/player/chapters';
import { hasPosterImage, playerPosterStyle } from '../ui/playerPoster';

const HOLD_MS = 1500;
const HOLD_NEAR_S = 3;

function Skip({
  label,
  text,
  d,
  disabled,
  onClick,
}: {
  label: string;
  text: string;
  d: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" class="m-now-skip" aria-label={label} disabled={disabled} onClick={onClick}>
      <Icon d={d} size={26} />
      {text}
    </button>
  );
}

export function NowPlaying({ volume = tvVolume }: { volume?: (dir: 'up' | 'down') => Promise<void> }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [held, setHeld] = useState<{ t: number; seen: number; at: number } | null>(null);
  const [tracks, setTracks] = useState(false);
  const s = nowPlaying.value;
  const status = linkStatus.value;
  const empty = !s || status === 'none';
  useEffect(() => {
    if (empty) {
      setDrag(null);
      setHeld(null);
    }
  }, [empty]);
  useEffect(() => {
    if (!held) return;
    const t = setTimeout(() => setHeld(null), HOLD_MS);
    return () => clearTimeout(t);
  }, [held]);
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

  if (!s || empty) {
    if (!s && launching.value) {
      return (
        <div class="m-screen m-now" data-route="nowPlaying">
          {head}
          <div class="m-now-empty">
            <div class="m-sheet-title">Запускаем на телевизоре…</div>
          </div>
        </div>
      );
    }
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

  const off = status !== 'live';
  // after a release keep the target on screen until the TV reports a time near it (or the hold expires)
  const holding =
    held !== null &&
    Date.now() - held.at < HOLD_MS &&
    !(lastSeen.value > held.seen && Math.abs(s.time - held.t) <= HOLD_NEAR_S);
  const shown = drag ?? (holding ? held!.t : s.time);
  const max = Math.max(1, s.duration);
  const pct = Math.max(0, Math.min(100, (shown / max) * 100));
  const list: Chapter[] = (s.chapters || []).map((c) => ({ start: c.t, end: c.t, title: c.title, kind: null }));
  const local = chapterIndexAt(list, shown);
  const cur = drag !== null || holding || s.chapter === undefined ? local : s.chapter;
  const chapterName = (i: number) => chapterLabel(list[i], i);
  const stepChapter = (dir: 1 | -1) => {
    const i = chapterStepIndex(list, shown, dir);
    if (i === null) return;
    if (i >= 0) sendCmd({ type: 'chapter', i });
    else sendCmd({ type: 'seek', t: 0 });
    setHeld({ t: i >= 0 ? list[i].start : 0, seen: lastSeen.value, at: Date.now() });
  };
  const left = s.duration > 0 ? '−' + formatDuration(Math.max(0, s.duration - shown)) : '';
  return (
    <div class="m-screen m-now" data-route="nowPlaying">
      {head}
      <div class="m-now-poster" style={playerPosterStyle(s)}>
        {!hasPosterImage(s) && displayTitle(s.title)}
      </div>
      <div class="m-now-titles">
        <div class="m-now-title">{displayTitle(s.title)}</div>
        <div class="m-now-sub">{s.subtitle}</div>
      </div>
      <div class="m-now-seek">
        <div class="m-seek">
          <div class="m-seek-fill" style={{ width: pct + '%' }} />
          {s.duration > 0 &&
            list.map(
              (c, i) =>
                c.start > 0 &&
                c.start < s.duration && (
                  <span key={i} class="m-seek-tick" style={{ left: (c.start / s.duration) * 100 + '%' }} />
                ),
            )}
          <input
            type="range"
            class="m-seek-input"
            aria-label="Перемотка"
            min={0}
            max={max}
            step={1}
            disabled={off || s.duration <= 0}
            value={shown}
            onInput={(e) => setDrag(Number((e.currentTarget as HTMLInputElement).value))}
            onChange={(e) => {
              const t = Number((e.currentTarget as HTMLInputElement).value);
              sendCmd({ type: 'seek', t });
              setHeld({ t, seen: lastSeen.value, at: Date.now() });
              setDrag(null);
            }}
          />
        </div>
        <div class="m-now-times">
          <span>{formatDuration(shown)}</span>
          <span>{left}</span>
        </div>
      </div>
      {list.length > 0 && (
        <div class="m-now-chapter">
          <button
            type="button"
            class="m-now-chbtn"
            aria-label="Предыдущая глава"
            disabled={off}
            onClick={() => stepChapter(-1)}
          >
            <Icon d={ICONS.prev} size={22} />
          </button>
          <span class="m-now-chtext">
            <span class="m-now-chnum">
              {cur >= 0 ? 'Глава ' + (cur + 1) + ' из ' + list.length : 'Глав: ' + list.length}
            </span>
            {cur >= 0 && list[cur].title.trim() !== '' && chapterName(cur)}
          </span>
          <button
            type="button"
            class="m-now-chbtn"
            aria-label="Следующая глава"
            disabled={off || chapterStepIndex(list, shown, 1) === null}
            onClick={() => stepChapter(1)}
          >
            <Icon d={ICONS.next} size={22} />
          </button>
        </div>
      )}
      <div class="m-now-controls">
        <Skip label="Предыдущая серия" text="" d={ICONS.prev} disabled={off} onClick={() => sendCmd({ type: 'prev' })} />
        <Skip
          label="Назад на 10 секунд"
          text="10"
          d={ICONS.back10}
          disabled={off}
          onClick={() => sendCmd({ type: 'skip', d: -10 })}
        />
        <button
          type="button"
          class="m-now-play"
          aria-label={s.paused ? 'Играть' : 'Пауза'}
          disabled={off}
          onClick={() => sendCmd({ type: s.paused ? 'play' : 'pause' })}
        >
          <Icon d={s.paused ? ICONS.play : ICONS.pause} size={32} />
        </button>
        <Skip
          label="Вперёд на 10 секунд"
          text="10"
          d={ICONS.fwd10}
          disabled={off}
          onClick={() => sendCmd({ type: 'skip', d: 10 })}
        />
        <Skip
          label="Следующая серия"
          text=""
          d={ICONS.next}
          disabled={off || !s.next}
          onClick={() => sendCmd({ type: 'next' })}
        />
      </div>
      <div class="m-now-row">
        <button type="button" class="m-now-wide" disabled={off} onClick={() => setTracks(true)}>
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
      {list.length > 0 && (
        <div class="m-now-chlist" role="group" aria-label="Главы">
          <div class="m-now-chhead">Главы</div>
          {list.map((c, i) => (
            <button
              key={i}
              type="button"
              class={'m-now-chitem' + (i === cur ? ' on' : '')}
              aria-current={i === cur ? 'true' : undefined}
              aria-label={chapterName(i) + ', с ' + formatDuration(c.start) + (i === cur ? ', сейчас идёт' : '')}
              disabled={off}
              onClick={() => {
                sendCmd({ type: 'chapter', i });
                setHeld({ t: c.start, seen: lastSeen.value, at: Date.now() });
              }}
            >
              <span class="m-now-chtime">{formatDuration(c.start)}</span>
              <span class="m-now-chname">{chapterName(i)}</span>
            </button>
          ))}
        </div>
      )}
      {s.next && (
        <div class="m-now-next">
          <span class="m-now-next-text">Дальше: {displayTitle(s.next.title)}</span>
          <button type="button" disabled={off} onClick={() => sendCmd({ type: 'next' })}>
            Включить
          </button>
        </div>
      )}
      {tracks && !off && (
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
