import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { client } from '../store/servers';
import { settings, updateSettings } from '../store/settings';
import { subSizeOptions, formatOffset, subtitleOffsetOptions } from '../player/subtitleOffset';
import { decideStart } from '../player/resume';
import type { FfprobeResult } from '../api/types';
import { errorMessage } from '../api/http';
import { getTrackPref, saveTrackPref } from '../store/trackPrefs';
import { pickAudio, pickSub, subPrefFromChoice } from '../player/trackPrefs';
import { parseSubtitles, decodeText, Cue } from '../lib/subtitles';
import { selectAudioTrack, selectTextTrack } from '../platform/webosMedia';
import type { PlayItem } from '../player/types';
import { SeekAccumulator } from '../player/seek';
import { tapZone, TapDetector, SeekStreak } from '../player/pointerTaps';
import type { TapZone } from '../player/pointerTaps';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { audioOptions, embeddedSubOptions, subtitleMenu, defaultAudioIndex } from '../player/trackOptions';
import { chapterList, chapterLabel, chapterIndexAt, chapterTarget, skipSegments, inIntro, introSkipTarget, applyMark, SKIP_TOAST_MS } from '../player/chapters';
import type { MarkKind } from '../player/chapters';
import type { SkipPrefs } from '../lib/journal';
import { formatDuration } from '../lib/format';
import { useVideoState } from '../player/useVideoState';
import { HideTimer, canHideControls, pointerMoveCounts } from '../player/hideTimer';
import { useProgressSync } from '../player/useProgressSync';
import { WatchJournal, journalSource } from '../player/watchJournal';
import { recordWatch, loadSkip, saveSkip } from '../store/journal';
import { getLocalProgress } from '../store/progress';
import { useNextEpisode } from '../player/useNextEpisode';
import { useCacheStats } from '../player/useCacheStats';
import { Controls } from '../player/Controls';
import { StatsOverlay, BufferingOverlay, SubtitleOverlay, NextBanner, SkipBanner, UndoBanner, PlayerError } from '../player/Overlays';
import { usePlayerHeading, itemHeading } from '../player/heading';
import { tvGlyphs } from '../ui/tvText';
import type { Cmd } from '../phone/protocol';
import { goBack } from '../ui/nav';
import { useKeys } from '../ui/keys';
import { choose, dialogOpen } from '../ui/dialog';
import { toast } from '../ui/toast';
import { setPlayerBridge, postSoon } from '../phone/link';
import { buildSnapshot, liveTiming, runCmd } from '../player/phoneBridge';
import { DonateCard, donateCardEnabled, donateMode } from '../player/DonateCard';
import { journalSupportActive } from '../store/support';

interface Props {
  queue: PlayItem[];
  index: number;
  startAt?: number;
  /** Name of the phone that launched the player (watch journal source). */
  from?: string;
}

export function PlayerScreen({ queue, index: startIndex, startAt, from }: Props) {
  const c = client.value;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(startIndex);
  const item = queue[index];
  // the title bar: the series name, the episode code and its TMDB name; a film's name
  const heading = usePlayerHeading(item);
  const [readyFor, setReadyFor] = useState(-1);
  const ready = readyFor === index;
  const subReq = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [probe, setProbe] = useState<FfprobeResult | null>(null);
  const [controls, setControls] = useState(true);
  const [statsOn, setStatsOn] = useState(settings.value.showStats);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [audioIdx, setAudioIdx] = useState(-1);
  const [subChoice, setSubChoice] = useState('off');
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [skippedIntro, setSkippedIntro] = useState<number | null>(null);
  const [subOffset, setSubOffset] = useState(0);
  const [prefs, setPrefs] = useState<SkipPrefs>({ i: false, c: false });
  const [undo, setUndo] = useState<{ start: number; text: string } | null>(null);
  /** Playback of the item has run (the «Поддержать» card waits for it: a loading video is paused too). */
  const [started, setStarted] = useState(false);
  const autoIntroDone = useRef(false);
  const autoCreditsDone = useRef(false);
  const pendingIntro = useRef<number | null>(null);
  const lastT = useRef(-1);
  const [probed, setProbed] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef(0);
  const userTracks = useRef(false);
  const metaLoaded = useRef(false);
  const probeRef = useRef<FfprobeResult | null>(null);
  probeRef.current = probe;
  const startUsed = useRef(false);

  const src = ready ? (c ? c.videoSrc(item.url) : item.url) : '';
  const vs = useVideoState(videoRef, index + ':' + reloadKey + ':' + src);
  const posRef = useRef({ time: 0, duration: 0 });
  posRef.current = { time: vs.time, duration: vs.duration };
  useProgressSync(c, item, posRef);
  // watch journal on TorrServer: an entry when the item starts (below) and when it is left
  const journal = useMemo(() => new WatchJournal((h, e) => { recordWatch(c, h, e); }, journalSource(from)), []);
  useEffect(() => () => journal.end(item, posRef.current.time, posRef.current.duration), [item]);

  const hasNext = index < queue.length - 1;
  const hasPrev = index > 0;
  const goNext = () => { if (hasNext) setIndex(index + 1); };
  const goPrev = () => { if (hasPrev) setIndex(index - 1); };

  const chapters = useMemo(() => chapterList(probe), [probe]);
  const chapterIdx = chapterIndexAt(chapters, vs.time);
  const segs = skipSegments(probe, prefs, vs.duration);

  const next = useNextEpisode({
    itemKey: index,
    enabled: settings.value.autoNext,
    hasNext,
    time: vs.time,
    duration: vs.duration,
    ended: vs.ended,
    paused: vs.paused,
    creditsStart: segs.credits ? segs.credits.start : null,
    onNext: goNext,
    onEnd: () => goBack(),
  });

  useEffect(() => { if (ready && !vs.paused && !vs.error) setStarted(true); }, [ready, vs.paused, vs.error]);
  const donate = donateMode({
    enabled: donateCardEnabled(journalSupportActive()),
    started: ready && started,
    error: !!vs.error,
    paused: vs.paused,
    time: vs.time,
    duration: vs.duration,
    creditsStart: segs.credits ? segs.credits.start : null,
    countdown: next.countdown !== null && hasNext,
  });

  const intro = inIntro(segs.intro, vs.time) ? segs.intro! : null;
  const showSkip = ready && !vs.error && !!intro && skippedIntro !== intro.start && next.countdown === null && !undo;
  const hideUndo = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  };
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  // skip settings of the torrent: loaded once when the player opens (and re-read for another torrent)
  useEffect(() => {
    setPrefs({ i: false, c: false });
    pendingIntro.current = null;
    if (!c || !item.hash) return;
    let cancelled = false;
    loadSkip(c, item.hash).then((p) => { if (!cancelled) setPrefs(p); }, () => undefined);
    return () => { cancelled = true; };
  }, [item.hash]);

  // auto skip: the intro on entering it, the credits (with a next item) at their start
  useEffect(() => {
    const v = videoRef.current;
    if (!ready || !v || vs.error || !metaLoaded.current) return;
    const ct = isFinite(v.currentTime) ? v.currentTime : vs.time;
    const prevT = lastT.current;
    lastT.current = ct;
    if (prefs.i && !autoIntroDone.current && segs.intro && inIntro(segs.intro, ct)) {
      autoIntroDone.current = true;
      const start = segs.intro.start;
      v.currentTime = introSkipTarget(segs.intro, vs.duration);
      postSoon();
      setSkippedIntro(start);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo({ start, text: t('tvPlayer.introSkipped') });
      undoTimer.current = setTimeout(hideUndo, SKIP_TOAST_MS);
      return;
    }
    if (prefs.c && hasNext && !autoCreditsDone.current && segs.credits && vs.duration > 0 && !v.paused && prevT >= 0 && prevT < segs.credits.start && ct >= segs.credits.start && ct - prevT < 5) {
      autoCreditsDone.current = true;
      toast(t('tvPlayer.creditsSkipped'));
      goNext();
    }
  }, [vs.time, ready, prefs, probe]);


  const cache = useCacheStats(c, item.hash, statsOn || (ready && vs.buffering));

  const hideGate = useRef({ paused: true, buffering: true, seeking: false, error: false });
  hideGate.current = { paused: vs.paused, buffering: vs.buffering, seeking: seekTarget !== null, error: !!vs.error };
  const lastPtr = useRef<{ x: number; y: number } | null>(null);
  const hider = useMemo(
    () => new HideTimer(
      () => canHideControls({ ...hideGate.current, dialogOpen: dialogOpen.value }),
      () => setControls(false),
    ),
    [],
  );
  const showControls = () => {
    setControls(true);
    hider.arm();
  };
  // (re)start of playback — incl. after phone commands or the end of buffering — re-arms the hide timer
  useEffect(() => {
    if (!vs.paused && !vs.buffering && !vs.error) hider.arm();
    else hider.cancel();
  }, [vs.paused, vs.buffering, vs.error, seekTarget === null, dialogOpen.value]);

  const [flash, setFlash] = useState<{ icon?: IconName; text?: string; side: TapZone } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = (f: { icon?: IconName; text?: string; side: TapZone }) => {
    setFlash(f);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 700);
  };
  const lastKeyAt = useRef(0);
  const streak = useMemo(() => new SeekStreak(), []);
  const tapActions = useRef({ single: () => undefined as void, double: (_z: TapZone) => undefined as void });
  tapActions.current = {
    single: () => {
      const v = videoRef.current;
      if (!v || !ready || vs.error) return;
      const willPlay = v.paused;
      togglePause();
      showFlash({ icon: willPlay ? 'play' : 'pause', side: 'center' });
    },
    double: (zone: TapZone) => {
      const v = videoRef.current;
      if (!v || !ready || vs.error || zone === 'center') return;
      const dir = zone === 'left' ? -1 : 1;
      const base = settings.value.edgeSeekStep || 5;
      const step = streak.next(dir, base);
      const max = vs.duration > 0 ? vs.duration - 1 : Infinity;
      const cur = v.currentTime;
      const target = dir < 0 ? Math.max(0, cur - step) : Math.max(cur, Math.min(max, cur + step));
      if (!isFinite(target) || target === cur) return;
      seekTo(target);
      showFlash({ text: (dir < 0 ? '−' : '+') + step + ' ' + t('common.sec'), side: zone });
    },
  };
  const taps = useMemo(() => new TapDetector({
    single: () => tapActions.current.single(),
    double: (z) => tapActions.current.double(z),
  }), []);
  useEffect(() => () => { taps.cancel(); if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // resume decision + ffprobe for every new item
  useEffect(() => {
    setSeekTarget(null);
    seeker.cancel();
    taps.cancel();
    subReq.current++;
    setProbe(null);
    setCues(null);
    setSubOffset(0);
    setSkippedIntro(null);
    setStarted(false);
    hideUndo();
    autoIntroDone.current = false;
    autoCreditsDone.current = false;
    lastT.current = -1;
    setProbed(false);
    setSubChoice('off');
    setAudioIdx(-1);
    userTracks.current = false;
    metaLoaded.current = false;
    showControls();
    let cancelled = false;
    let explicit: number | undefined;
    if (index === startIndex && startAt !== undefined && !startUsed.current) {
      startUsed.current = true;
      explicit = startAt;
    }
    decideStart(item, explicit).then((pos) => {
      if (cancelled) return;
      if (pos < 0) {
        goBack();
        return;
      }
      startPos.current = pos;
      const saved = item.hash && item.fileIndex !== undefined ? getLocalProgress(item.hash, item.fileIndex) : null;
      journal.start(item, pos, saved ? saved.duration : 0);
      setReadyFor(index);
    });
    if (c && item.hash && item.fileIndex !== undefined) {
      c.probe(item.hash, item.fileIndex).then((p) => { if (!cancelled) { setProbe(p); setProbed(true); } });
    } else {
      setProbed(true);
    }
    return () => { cancelled = true; };
  }, [index]);

  // release the media pipeline when the <video> is re-keyed (episode change / retry) or removed
  useEffect(() => {
    const v = videoRef.current;
    return () => {
      if (!v) return;
      v.pause();
      v.removeAttribute('src');
      v.load();
    };
  }, [index + ':' + reloadKey]);

  useEffect(() => () => hider.cancel(), []);

  const seeker = useMemo(
    () => new SeekAccumulator((t) => {
      const v = videoRef.current;
      if (v) v.currentTime = t;
      setSeekTarget(null);
    }),
    [],
  );
  useEffect(() => () => seeker.cancel(), []);

  const seek = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    setSeekTarget(seeker.press(dir, v.currentTime, vs.duration, settings.value.seekStep));
    showControls();
  };

  const seekTo = (t: number) => {
    seeker.cancel();
    setSeekTarget(null);
    const v = videoRef.current;
    if (v) v.currentTime = t;
    showControls();
    postSoon();
  };

  const openChapters = () => {
    if (!chapters.length) return;
    choose(t('player.chapters'), chapters.map((ch, i) => ({ label: formatDuration(ch.start) + ' · ' + chapterLabel(ch, i), value: i })), chapterIdx >= 0 ? chapterIdx : undefined)
      .then((i) => { if (i !== null) seekTo(chapters[i].start); });
  };

  const chapterStep = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    const t = chapterTarget(chapters, v.currentTime, dir);
    if (t !== null) seekTo(t);
  };

  const mark = (kind: MarkKind, now: number) => {
    const r = applyMark(kind, now, vs.duration, prefs, pendingIntro.current, formatDuration);
    pendingIntro.current = r.pending;
    if (!r.patch) {
      toast(r.text, r.error ? 'error' : 'info');
      return;
    }
    if (!c || !item.hash) {
      toast(t('player.markNoServer'), 'error');
      return;
    }
    saveSkip(c, { hash: item.hash }, r.patch).then(
      (saved) => { setPrefs(saved); toast(r.text); },
      (e) => toast(t('player.markSaveFailed', { error: errorMessage(e) }), 'error'),
    );
  };

  const togglePause = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      const p = v.play() as Promise<void> | undefined;
      if (p && p.catch) p.catch(() => undefined);
    } else {
      v.pause();
    }
    showControls();
  };

  const applySubChoice = (choice: string) => {
    const v = videoRef.current;
    if (!v) return;
    subReq.current++;
    setSubChoice(choice);
    setCues(null);
    if (choice === 'off') {
      selectTextTrack(v, -1);
      return;
    }
    const token = ++subReq.current;
    const n = +choice.slice(1);
    if (choice.charAt(0) === 'e') {
      selectTextTrack(v, n);
      return;
    }
    selectTextTrack(v, -1);
    const sub = (item.subtitles || [])[n];
    if (!sub || !c) return;
    c.fetchBytes(sub.url).then(
      (buf) => { if (subReq.current === token) setCues(parseSubtitles(decodeText(buf), sub.ext)); },
      (e) => { if (subReq.current === token) toast(t('tvPlayer.subLoadFailed', { error: errorMessage(e) }), 'error'); },
    );
  };

  const chooseAudio = (v: HTMLVideoElement, audio: { label: string; language: string }[], i: number) => {
    userTracks.current = true;
    setAudioIdx(i);
    selectAudioTrack(v, i);
    if (item.hash) saveTrackPref(item.hash, { audioLang: audio[i].language, audioLabel: audio[i].label });
  };

  const applyDefaultTracks = () => {
    const v = videoRef.current;
    if (!v || userTracks.current) return;
    const s = settings.value;
    const pref = item.hash ? getTrackPref(item.hash) : null;
    const audio = audioOptions(probeRef.current, v);
    const ai = pickAudio(audio, pref, s.audioLang);
    if (ai >= 0) {
      setAudioIdx(ai);
      if (ai !== defaultAudioIndex(audio)) selectAudioTrack(v, ai);
    }
    applySubChoice(pickSub(embeddedSubOptions(probeRef.current, v), item.subtitles || [], pref, s));
  };

  // ffprobe often arrives after metadata: re-apply language defaults
  useEffect(() => {
    if (probe && metaLoaded.current) applyDefaultTracks();
  }, [probe]);

  const onMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    metaLoaded.current = true;
    if (startPos.current > 0) {
      try { v.currentTime = startPos.current; } catch (e) { /* not seekable yet */ }
    }
    applyDefaultTracks();
  };

  const openTrackMenu = () => {
    const v = videoRef.current;
    if (!v) return;
    const audio = audioOptions(probe, v);
    const menu = subtitleMenu(embeddedSubOptions(probe, v), item.subtitles || []);
    const current = menu.find((o) => o.value === subChoice) || menu[0];
    const audioLabel = audio[audioIdx] ? audio[audioIdx].label : t('tvPlayer.byDefault');
    const sizeLabel = (subSizeOptions().find((o) => o.value === settings.value.subSize) || subSizeOptions()[1]).label;
    const root: { label: string; value: string }[] = [
      { label: t('tvPlayer.audioRow', { v: audioLabel }), value: 'audio' },
      { label: t('tvPlayer.subsRow', { v: current.label }), value: 'subs' },
      { label: t('tvPlayer.subSizeRow', { v: sizeLabel }), value: 'size' },
    ];
    if (cues) root.push({ label: t('tvPlayer.offsetRow', { v: formatOffset(subOffset) }), value: 'offset' });
    if (chapters.length) root.push({ label: t('tvPlayer.chaptersRow', { n: chapters.length }), value: 'chapters' });
    const now = v.currentTime;
    const credits = prefs.mc && vs.duration > prefs.mc ? formatDuration(vs.duration - prefs.mc) : '—';
    root.push(
      { label: t('tvPlayer.markIntroStartRow', { v: pendingIntro.current !== null ? formatDuration(pendingIntro.current) : prefs.mi ? formatDuration(prefs.mi[0]) : '—' }), value: 'mark-intro-start' },
      { label: t('tvPlayer.markIntroEndRow', { v: (pendingIntro.current !== null ? t('tvPlayer.pendingStart', { t: formatDuration(pendingIntro.current) }) : '') + t('tvPlayer.atNow', { t: formatDuration(now) }) }), value: 'mark-intro-end' },
      { label: t('tvPlayer.markCreditsRow', { v: credits }), value: 'mark-credits' },
    );
    choose(t('tvPlayer.menuTitle'), root).then((kind) => {
      if (kind === 'chapters') openChapters();
      else if (kind === 'mark-intro-start') mark('intro-start', now);
      else if (kind === 'mark-intro-end') mark('intro-end', now);
      else if (kind === 'mark-credits') mark('credits', now);
      if (kind === 'audio') {
        if (audio.length < 2) {
          toast(t('tvPlayer.noOtherAudio'));
          return;
        }
        choose(t('tvPlayer.audio'), audio.map((a, i) => ({ label: a.label, value: i })), audioIdx).then((i) => {
          if (i === null) return;
          chooseAudio(v, audio, i);
        });
      } else if (kind === 'subs') {
        choose(t('common.subtitles'), menu, subChoice).then((ch) => {
          if (ch === null) return;
          userTracks.current = true;
          applySubChoice(ch);
          if (item.hash) saveTrackPref(item.hash, { sub: subPrefFromChoice(ch, embeddedSubOptions(probe, v), item.subtitles || []) });
        });
      } else if (kind === 'size') {
        choose(t('tvPlayer.subSize'), subSizeOptions(), settings.value.subSize).then((size) => { if (size) updateSettings({ subSize: size }); });
      } else if (kind === 'offset') {
        choose(t('tvPlayer.offset'), subtitleOffsetOptions(), subOffset).then((off) => { if (off !== null) setSubOffset(off); });
      }
    });
  };

  // phone bridge: refs-style, re-pointed every render so snapshot()/exec() see current values
  const phoneToasted = useRef(false);
  const bridgeImpl = useRef({ snapshot: (): ReturnType<typeof buildSnapshot> => null, exec: (_c: Cmd) => undefined as void });
  bridgeImpl.current = {
    snapshot: () => {
      const v = videoRef.current;
      const audio = audioOptions(probe, v);
      const live = liveTiming(v, { time: vs.time, paused: vs.paused });
      return buildSnapshot({
        queue, index,
        time: live.time, duration: vs.duration, paused: live.paused, buffering: ready && vs.buffering,
        audio, audioIdx, defaultAudio: defaultAudioIndex(audio),
        subs: subtitleMenu(embeddedSubOptions(probe, v), item.subtitles || []), subChoice,
        chapters,
      });
    },
    exec: (cmd: Cmd) => {
      const v = videoRef.current;
      if (!v || !ready) return;
      if (!phoneToasted.current) {
        phoneToasted.current = true;
        toast(t('tvPlayer.phoneControl'));
      }
      const audio = audioOptions(probeRef.current, v);
      const menu = subtitleMenu(embeddedSubOptions(probeRef.current, v), item.subtitles || []);
      runCmd(cmd, {
        paused: v.paused, time: v.currentTime, duration: vs.duration,
        subValues: menu.map((o) => o.value), audioCount: audio.length,
        chapterStarts: chapterList(probeRef.current).map((c) => c.start),
        toggle: togglePause, seekTo, next: goNext, prev: goPrev,
        audio: (i) => chooseAudio(v, audio, i),
        subs: (value) => {
          userTracks.current = true;
          applySubChoice(value);
          if (item.hash) saveTrackPref(item.hash, { sub: subPrefFromChoice(value, embeddedSubOptions(probeRef.current, v), item.subtitles || []) });
        },
      });
      postSoon();
    },
  };
  useEffect(() => setPlayerBridge({
    snapshot: () => bridgeImpl.current.snapshot(),
    exec: (c) => bridgeImpl.current.exec(c),
  }), []);
  useEffect(() => { postSoon(); }, [index, vs.paused]);

  const undoSkip = () => {
    if (!undo) return;
    seekTo(undo.start);
    hideUndo();
  };

  const retry = () => {
    startPos.current = posRef.current.time;
    userTracks.current = false;
    setReloadKey(reloadKey + 1);
  };

  useKeys((a) => {
    if (vs.error) return false; // error view buttons use spatial navigation
    lastKeyAt.current = Date.now();
    taps.cancel();
    if (next.countdown !== null) {
      if (a === 'enter') { goNext(); return true; }
      if (a === 'back') { next.dismiss(); return true; }
    }
    if (undo) {
      if (a === 'enter') { undoSkip(); return true; }
      if (a === 'back') { hideUndo(); return true; }
    }
    if (showSkip && intro) {
      if (a === 'enter') { seekTo(introSkipTarget(intro, vs.duration)); setSkippedIntro(intro.start); return true; }
      if (a === 'back') { setSkippedIntro(intro.start); return true; }
    }
    switch (a) {
      case 'enter':
      case 'playpause':
        togglePause();
        return true;
      case 'play': {
        const v = videoRef.current;
        if (v && v.paused) togglePause();
        return true;
      }
      case 'pause': {
        const v = videoRef.current;
        if (v && !v.paused) togglePause();
        return true;
      }
      case 'stop':
        goBack();
        return true;
      case 'left':
      case 'rw':
        seek(-1);
        return true;
      case 'right':
      case 'ff':
        seek(1);
        return true;
      case 'up':
      case 'yellow':
        openTrackMenu();
        return true;
      case 'down':
        showControls();
        return true;
      case 'green':
      case 'info':
        setStatsOn(!statsOn);
        return true;
      case 'chup':
      case 'chdown':
        if (chapters.length) chapterStep(a === 'chup' ? 1 : -1);
        else if (!probed) return true; // ffprobe has not answered yet: the file may have chapters
        else if (a === 'chup') goNext();
        else goPrev();
        showControls();
        return true;
      case 'next':
        goNext();
        return true;
      case 'prev':
        goPrev();
        return true;
      case 'back':
        if (controls && !vs.paused) {
          setControls(false);
          return true;
        }
        goBack();
        return true;
    }
    return false;
  });

  if (!item) return null;

  return (
    <div class="player" onMouseMove={(e) => { const m = e as MouseEvent; if (pointerMoveCounts(controls, lastPtr.current, m.clientX, m.clientY)) { lastPtr.current = { x: m.clientX, y: m.clientY }; showControls(); } }} onClick={(e) => { if (Date.now() - lastKeyAt.current < 250) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); taps.tap(tapZone((e as MouseEvent).clientX - r.left, r.width)); }}>
      <video key={index + ':' + reloadKey} ref={videoRef} src={ready ? src : undefined} autoplay onLoadedMetadata={onMeta} />
      <SubtitleOverlay cues={cues} time={vs.time} offset={subOffset} raised={controls} />
      {flash && <div class={'tap-flash tap-' + flash.side}>{flash.icon ? <Icon name={flash.icon} size={88} /> : flash.text}</div>}
      {ready && vs.buffering && !vs.error && <BufferingOverlay cache={cache} />}
      {statsOn && <StatsOverlay cache={cache} probe={probe} />}
      <DonateCard mode={donate} raised={donate === 'credits' && controls} />
      {next.countdown !== null && hasNext && (
        <NextBanner seconds={next.countdown} title={tvGlyphs(itemHeading(queue[index + 1]))} onNext={goNext} />
      )}
      {showSkip && intro && <SkipBanner lift={donate === 'pause'} onSkip={() => { seekTo(introSkipTarget(intro, vs.duration)); setSkippedIntro(intro.start); }} />}
      {undo && next.countdown === null && <UndoBanner text={undo.text} lift={donate === 'pause'} onUndo={undoSkip} />}
      {(controls || vs.paused) && !vs.error && (
        <Controls
          title={tvGlyphs(heading)}
          time={vs.time}
          duration={vs.duration}
          paused={vs.paused}
          seekTarget={seekTarget}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onToggle={togglePause}
          onSeekTo={seekTo}
          onPrev={goPrev}
          onNext={goNext}
          onTracks={openTrackMenu}
          chapters={chapters}
          chapterIdx={chapterIdx}
          onChapters={openChapters}
        />
      )}
      {vs.error && <PlayerError message={vs.error} probe={probe} onRetry={retry} onBack={() => goBack()} />}
    </div>
  );
}
