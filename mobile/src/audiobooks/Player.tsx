// The audiobook player: play/pause, ±30s, previous/next chapter, speed and a sleep timer.
// Sound, the shade and the lock screen belong to the native session. This screen only drives it.
import { useEffect, useState } from 'preact/hooks';
import { AUDIO_SEEK_MS, AUDIO_SPEEDS, SLEEP_CHOICES } from '../../../src/lib/audiobookPlayback';
import { formatDuration } from '../../../src/lib/format';
import { saveProgress } from '../../../src/store/progress';
import { t } from '../../../src/i18n';
import type { AudioPlayState } from '../platform/native';
import { audioBridge, audioLaunch } from './launch';
import { AudiobookBar } from './bar';

const SLEEP_LABEL: { [k: string]: () => string } = {
  off: () => t('audiobooks.sleepOff'),
  '15': () => t('audiobooks.sleep15'),
  '30': () => t('audiobooks.sleep30'),
  '60': () => t('audiobooks.sleep60'),
  chapter: () => t('audiobooks.sleepChapter'),
};

export function AudioPlayer({ hash, token }: { hash: string; token: number }) {
  const launch = audioLaunch.value;
  const mine = launch && launch.hash === hash && launch.token === token ? launch : null;
  const [state, setState] = useState<AudioPlayState | null>(null);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState(1);
  const [sleep, setSleep] = useState('off');

  useEffect(() => {
    if (!mine) return;
    let alive = true;
    const b = audioBridge();
    b.play(mine).then(
      (s) => {
        if (!alive) return;
        if (!s) setError(t('audiobooks.playerUnavailable'));
        else setState(s);
      },
      (err) => alive && setError(err && err.message ? String(err.message) : t('audiobooks.playerUnavailable')),
    );
    const off = b.onState((s) => {
      if (!alive) return;
      setState(s);
      if (s.error) setError(s.error);
    });
    return () => {
      alive = false;
      off();
    };
  }, [mine ? mine.token : 0]);

  useEffect(() => {
    if (!mine || !state || !state.active) return;
    const item = mine.items[state.index] || mine.items[mine.start];
    if (!item) return;
    const at = (item.startMs + state.positionMs) / 1000;
    const dur = state.durationMs > 0 ? (item.startMs + state.durationMs) / 1000 : 0;
    if (at >= 1) saveProgress(mine.hash, item.fileId, at, dur);
  }, [state ? state.positionMs : 0, state ? state.index : 0]);

  if (!mine) {
    return (
      <div class="m-screen" data-route="audiobook-player">
        <AudiobookBar title={t('audiobooks.player')} />
        <p class="m-muted m-note">{t('audiobooks.nothingToPlay')}</p>
      </div>
    );
  }

  const shown = state && state.active ? state : null;
  const index = shown ? shown.index : mine.start;
  const item = mine.items[index] || mine.items[mine.start];
  const title = (shown && shown.title) || (item ? item.title : mine.book);
  const playing = shown ? shown.playing : false;
  const position = shown ? shown.positionMs : 0;
  const duration = shown ? shown.durationMs : 0;
  const curSpeed = shown ? shown.speed : speed;
  const curSleep = shown ? shown.sleep : sleep;

  const send = (cmd: 'toggle' | 'seek' | 'next' | 'prev' | 'speed' | 'sleep', extra?: { ms?: number; speed?: number; sleep?: string }) => {
    const b = audioBridge();
    b.control({ cmd, ...extra }).then(
      (s) => {
        if (!s) return;
        setState(s);
        if (typeof s.speed === 'number') setSpeed(s.speed);
        if (s.sleep) setSleep(s.sleep);
      },
      (err) => setError(err && err.message ? String(err.message) : t('audiobooks.playerUnavailable')),
    );
  };

  return (
    <div class="m-screen" data-route="audiobook-player">
      <AudiobookBar title={mine.book} />
      <p class="m-audio-title" data-audio-title="">{title}</p>
      <p class="m-audio-time" data-audio-time="">
        {duration > 0
          ? formatDuration(position / 1000) + ' / ' + formatDuration(duration / 1000)
          : formatDuration(position / 1000)}
      </p>
      {duration > 0 && (
        <input
          class="m-audio-range"
          type="range"
          min={0}
          max={duration}
          value={position}
          aria-label={t('audiobooks.player')}
          onChange={(e) => {
            const to = Number((e.target as HTMLInputElement).value);
            send('seek', { ms: to - position });
          }}
        />
      )}
      {error && <div class="m-error">{error}</div>}
      <div class="m-audio-transport">
        <button type="button" class="m-btn m-btn-secondary" data-audio="prev" onClick={() => send('prev')}>
          {t('audiobooks.prevChapter')}
        </button>
        <button type="button" class="m-btn m-btn-secondary" data-audio="back" onClick={() => send('seek', { ms: -AUDIO_SEEK_MS })}>
          {t('audiobooks.back30')}
        </button>
        <button type="button" class="m-btn m-btn-primary" data-audio="toggle" aria-label={playing ? t('audiobooks.pause') : t('audiobooks.resume')} onClick={() => send('toggle')}>
          {playing ? t('audiobooks.pause') : t('audiobooks.resume')}
        </button>
        <button type="button" class="m-btn m-btn-secondary" data-audio="forward" onClick={() => send('seek', { ms: AUDIO_SEEK_MS })}>
          {t('audiobooks.forward30')}
        </button>
        <button type="button" class="m-btn m-btn-secondary" data-audio="next" onClick={() => send('next')}>
          {t('audiobooks.nextChapter')}
        </button>
      </div>
      <section class="m-set-group">
        <div class="m-set-label">{t('audiobooks.speed')}</div>
        <div class="m-audio-chips" data-audio-speed="">
          {AUDIO_SPEEDS.map((n) => (
            <button
              key={n}
              type="button"
              class={'m-btn m-btn-secondary m-btn-sm' + (curSpeed === n ? ' on' : '')}
              aria-pressed={curSpeed === n}
              onClick={() => {
                setSpeed(n);
                send('speed', { speed: n });
              }}
            >
              {String(n) + '×'}
            </button>
          ))}
        </div>
      </section>
      <section class="m-set-group">
        <div class="m-set-label">{t('audiobooks.sleep')}</div>
        <div class="m-audio-chips" data-audio-sleep="">
          {SLEEP_CHOICES.map((id) => (
            <button
              key={id}
              type="button"
              class={'m-btn m-btn-secondary m-btn-sm' + (curSleep === id ? ' on' : '')}
              aria-pressed={curSleep === id}
              data-sleep={id}
              onClick={() => {
                setSleep(id);
                send('sleep', { sleep: id });
              }}
            >
              {SLEEP_LABEL[id]()}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
