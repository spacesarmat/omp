package com.spacesarmat.omp.player

import android.app.Instrumentation
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.spacesarmat.omp.R
import com.spacesarmat.omp.control.AppForeground
import java.util.Locale
import org.json.JSONObject

/**
 * Native player on Android TV (Media3 ExoPlayer) with the OMP overlay: title, progress, time, «Пауза»,
 * «Аудио: …», «Субтитры: …», «Следующая серия», key hints and the «Управление с телефона» badge.
 * Keys: ◀/▶ seek by the settings step with the LG arrow rule ([SeekAccumulator]: ×(1 + repeats/4) up to ×6,
 * one seek 700 ms after the last press),
 * OK pause, ▲ / Menu the player menu (tracks, «Главы», «Отметить …»), CH+ / CH− (Page Up / Down) the next /
 * previous chapter (episode when the file has none), ⏭ / ⏮ the next / previous episode, Back closes.
 * At the end of an item: «Следующая серия через N» (5 s) or close; with known credits the countdown starts there.
 * Chapters and skips come from the page per item ([SkipState]): ticks, «Пропустить заставку», auto skip of the
 * intro with «Вернуть», credits auto skip to the next item (as the LG player).
 * Moving to another item starts it from its resume point (queue `resume`, updated when an item is left).
 * Events go to the page through [NativePlayerBridge]; AC3/E-AC3/DTS use the default renderers
 * (passthrough over HDMI when the device reports support; no FFmpeg extension).
 */
@OptIn(UnstableApi::class)
class PlayerActivity : AppCompatActivity() {
    private lateinit var exo: ExoPlayer
    private lateinit var req: PlayRequest
    private val handler = Handler(Looper.getMainLooper())

    private lateinit var controls: View
    private lateinit var title: TextView
    private lateinit var progress: ProgressBar
    private lateinit var time: TextView
    private lateinit var btnPause: TextView
    private lateinit var btnAudio: TextView
    private lateinit var btnSubs: TextView
    private lateinit var btnNext: TextView
    private lateinit var buffering: View
    private lateinit var badge: View
    private lateinit var nextBox: View
    private lateinit var nextCount: TextView
    private lateinit var nextTitle: TextView
    private lateinit var btnSkip: TextView
    private lateinit var errorBox: View
    private lateinit var errorText: TextView
    private lateinit var ticksView: ChapterTicksView
    private lateinit var hint: TextView
    private lateinit var toastBox: View
    private lateinit var toastText: TextView
    private lateinit var toastUndo: View

    private var session: Long? = null
    private var closedSent = false
    private var controlsShown = true
    private val seeker = SeekAccumulator({ SystemClock.uptimeMillis() })
    private var resumeMs = LongArray(0)
    private var lastIndex = -1
    private var lastPosMs = 0L
    private var lastDurMs = 0L
    private var countdown = -1
    private var error: String? = null
    private var ticks = 0
    private var dialog: AlertDialog? = null
    private val skips = SkipState()
    /** «Заставка пропущена · Вернуть» on screen: the intro start OK returns to. */
    private var undoStart: Long? = null
    /** The running countdown started at the credits (pausing hides it, Back dismisses it for this item). */
    private var creditsCountdown = false

    private var toastShown = false
    private val hideToast = Runnable {
        undoStart = null
        toastShown = false
        render()
    }
    private val hideControls = Runnable {
        controlsShown = false
        render()
    }
    private val commitSeek = Runnable {
        val t = seeker.take()
        if (t != null) {
            skips.seeked()
            exo.seekTo(t)
        }
        render()
        emitState()
    }
    private val countdownTick = object : Runnable {
        override fun run() {
            if (countdown < 0) return
            countdown--
            if (countdown <= 0) playNext() else {
                render()
                handler.postDelayed(this, 1000)
            }
        }
    }
    private val tick = object : Runnable {
        override fun run() {
            if (exo.currentMediaItemIndex == lastIndex) {
                lastPosMs = exo.currentPosition
                lastDurMs = durationMs()
            }
            checkSkips()
            render()
            if (++ticks % 2 == 0) emitState()
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val r = NativePlayerBridge.request
        if (r == null) {
            // process restarted without a request from the page
            closedSent = true
            finish()
            return
        }
        req = r
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        setContentView(R.layout.activity_player)
        controls = findViewById(R.id.player_controls)
        title = findViewById(R.id.player_title)
        progress = findViewById(R.id.player_progress)
        time = findViewById(R.id.player_time)
        btnPause = findViewById(R.id.player_btn_pause)
        btnAudio = findViewById(R.id.player_btn_audio)
        btnSubs = findViewById(R.id.player_btn_subs)
        btnNext = findViewById(R.id.player_btn_next)
        buffering = findViewById(R.id.player_buffering)
        badge = findViewById(R.id.player_badge)
        nextBox = findViewById(R.id.player_next_box)
        nextCount = findViewById(R.id.player_next_count)
        nextTitle = findViewById(R.id.player_next_title)
        btnSkip = findViewById(R.id.player_skip_intro)
        errorBox = findViewById(R.id.player_error)
        errorText = findViewById(R.id.player_error_text)
        ticksView = findViewById(R.id.player_ticks)
        hint = findViewById(R.id.player_hint)
        toastBox = findViewById(R.id.player_toast)
        toastText = findViewById(R.id.player_toast_text)
        toastUndo = findViewById(R.id.player_toast_undo)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = onBack()
        })
        exo = buildPlayer()
        findViewById<PlayerView>(R.id.player_view).player = exo
        NativePlayerBridge.player = this
        load(r)
    }

    override fun onStart() {
        super.onStart()
        handler.removeCallbacks(tick)
        if (::exo.isInitialized) handler.post(tick)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val r = NativePlayerBridge.request
        if (r == null || !::req.isInitialized || r === req) return
        // the page launched another queue while the player is open: the previous run ends as «replaced»
        emitClosed(replaced = true)
        req = r
        load(r)
    }

    override fun onResume() {
        super.onResume()
        AppForeground.player = true
    }

    override fun onPause() {
        AppForeground.player = false
        super.onPause()
    }

    override fun onStop() {
        super.onStop()
        handler.removeCallbacks(tick)
        if (::exo.isInitialized && !isFinishing) exo.pause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        dialog?.dismiss()
        if (::exo.isInitialized) {
            emitClosed(replaced = false)
            exo.release()
        }
        if (NativePlayerBridge.player === this) NativePlayerBridge.player = null
        super.onDestroy()
    }

    // ---- player ----

    private fun buildPlayer(): ExoPlayer {
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("OMP")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(30_000)
            .setReadTimeoutMs(60_000)
        // TorrServer Basic auth: credentials come in the URL (as for <video> on LG) and go out as a header
        val auth = ResolvingDataSource.Factory(http) { spec -> withBasicAuth(spec) }
        val sources = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, auth))
        val renderers = DefaultRenderersFactory(this).setEnableDecoderFallback(true)
        val attrs = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build()
        val p = ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(sources)
            .setAudioAttributes(attrs, true)
            .setHandleAudioBecomingNoisy(true)
            .build()
        p.pauseAtEndOfMediaItems = true
        p.addListener(object : Player.Listener {
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) onItemEnd()
                changed()
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) onItemEnd()
                if (state == Player.STATE_READY && error != null) {
                    error = null
                }
                changed()
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                cancelCountdown()
                handler.removeCallbacks(commitSeek)
                seeker.cancel()
                skips.enter()
                if (undoStart != null) hideMessage()
                if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) resumeItem()
                showControls()
                changed()
            }

            override fun onTracksChanged(tracks: Tracks) = changed()

            override fun onPlayerError(e: PlaybackException) {
                error = describe(e)
                changed()
            }
        })
        return p
    }

    private fun changed() {
        render()
        emitState()
    }

    private fun load(r: PlayRequest) {
        cancelCountdown()
        handler.removeCallbacks(commitSeek)
        seeker.cancel()
        error = null
        resumeMs = LongArray(r.queue.size) { r.queue[it].resumeMs }
        lastIndex = r.index
        lastPosMs = r.startAtMs
        lastDurMs = 0L
        closedSent = false
        session = r.session
        skips.clear()
        hideMessage()
        applySkips()
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
            .clearOverrides()
            .setPreferredAudioLanguage(r.audioLang.ifEmpty { null })
            .setPreferredTextLanguage(r.subLang.ifEmpty { null })
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !r.subtitlesOn)
            .build()
        exo.setMediaItems(r.queue.mapIndexed { i, q -> mediaItem(i, q) }, r.index, r.startAtMs)
        exo.prepare()
        exo.playWhenReady = true
        showControls()
    }

    private fun mediaItem(i: Int, q: QueueItem): MediaItem {
        val subs = ArrayList<MediaItem.SubtitleConfiguration>()
        q.subtitles.forEachIndexed { n, s ->
            val mime = subMime(s.ext) ?: return@forEachIndexed
            if (s.url.isEmpty()) return@forEachIndexed
            val b = MediaItem.SubtitleConfiguration.Builder(Uri.parse(s.url))
                .setMimeType(mime)
                .setLabel(s.label)
                .setId(EXTERNAL_ID + n)
            if (s.lang.isNotEmpty()) b.setLanguage(s.lang)
            subs.add(b.build())
        }
        return MediaItem.Builder().setUri(q.url).setMediaId("omp-$i").setSubtitleConfigurations(subs).build()
    }

    private fun index(): Int = exo.currentMediaItemIndex.coerceIn(0, req.queue.size - 1)

    private fun hasNext(): Boolean = index() < req.queue.size - 1

    private fun durationMs(): Long = exo.duration.let { if (it == C.TIME_UNSET || it < 0) 0L else it }

    // ---- tracks ----

    private class AudioOpt(val group: Tracks.Group, val label: String)
    private class SubOpt(val value: String, val label: String, val group: Tracks.Group?)

    private fun audioOptions(): List<AudioOpt> {
        val out = ArrayList<AudioOpt>()
        for (g in exo.currentTracks.groups) {
            if (g.type != C.TRACK_TYPE_AUDIO || !g.isSupported) continue
            out.add(AudioOpt(g, audioLabel(g.getTrackFormat(0), out.size + 1)))
        }
        return out
    }

    /** «Выкл», embedded tracks (e<n>) and the queue item's files (x<n>): the same values as subtitleMenu on LG. */
    private fun subOptions(): List<SubOpt> {
        val out = arrayListOf(SubOpt("off", "Выкл", null))
        val external = ArrayList<Pair<Int, SubOpt>>()
        var embedded = 0
        for (g in exo.currentTracks.groups) {
            if (g.type != C.TRACK_TYPE_TEXT || !g.isSupported) continue
            val f = g.getTrackFormat(0)
            val x = f.id?.let { EXTERNAL_RE.find(it) }?.groupValues?.get(1)?.toIntOrNull()
            if (x != null) {
                val label = req.queue.getOrNull(index())?.subtitles?.getOrNull(x)?.label ?: (f.label ?: "Файл")
                external.add(x to SubOpt("x$x", "$label (файл)", g))
            } else {
                out.add(SubOpt("e$embedded", subLabel(f, embedded + 1), g))
                embedded++
            }
        }
        external.sortBy { it.first }
        external.forEach { out.add(it.second) }
        return out
    }

    private fun selectedAudio(list: List<AudioOpt>): Int = list.indexOfFirst { it.group.isSelected }

    private fun selectedSub(list: List<SubOpt>): SubOpt =
        list.firstOrNull { it.group != null && it.group.isSelected } ?: list[0]

    private fun selectAudio(i: Int) {
        val o = audioOptions().getOrNull(i) ?: return
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(o.group.mediaTrackGroup, 0))
            .build()
    }

    private fun selectSub(value: String) {
        val b = exo.trackSelectionParameters.buildUpon()
        if (value == "off") {
            b.clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            val o = subOptions().firstOrNull { it.value == value } ?: return
            val g = o.group ?: return
            b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0))
        }
        exo.trackSelectionParameters = b.build()
    }

    /**
     * «Меню плеера»: «Аудио», «Субтитры», «Главы» (when the file has chapters) and the three «Отметить …» rows
     * (as on LG). The marks use the position at the time the menu opened.
     */
    private fun openMenu() {
        if (dialog?.isShowing == true) return
        showControls()
        val i = index()
        val now = (seeker.pending() ?: exo.currentPosition).coerceAtLeast(0L)
        val dur = durationMs()
        val audio = audioOptions()
        val subs = subOptions()
        val aSel = selectedAudio(audio)
        val sSel = selectedSub(subs)
        val chapters = skips.chapters(i)
        val rows = ArrayList<Pair<String, () -> Unit>>()
        rows.add(("Аудио: " + (audio.getOrNull(aSel)?.label ?: "по умолчанию")) to {
            if (audio.size >= 2) {
                dialog = AlertDialog.Builder(this, R.style.OmpPlayerDialog)
                    .setTitle("Аудио")
                    .setSingleChoiceItems(audio.map { it.label }.toTypedArray(), aSel) { d, n ->
                        d.dismiss()
                        selectAudio(n)
                    }
                    .show()
            }
        })
        rows.add(("Субтитры: " + sSel.label) to {
            dialog = AlertDialog.Builder(this, R.style.OmpPlayerDialog)
                .setTitle("Субтитры")
                .setSingleChoiceItems(subs.map { it.label }.toTypedArray(), subs.indexOf(sSel)) { d, n ->
                    d.dismiss()
                    selectSub(subs[n].value)
                }
                .show()
        })
        if (chapters.isNotEmpty()) rows.add(("Главы: " + chapters.size) to { openChapters(i, now) })
        val marks = markRows(skips.info(i), now, dur)
        listOf("intro-start", "intro-end", "credits").forEachIndexed { n, kind ->
            rows.add(marks[n] to { emitMark(i, kind, now, dur) })
        }
        dialog = AlertDialog.Builder(this, R.style.OmpPlayerDialog)
            .setTitle("Меню плеера")
            .setItems(rows.map { it.first }.toTypedArray()) { _, which -> rows.getOrNull(which)?.second?.invoke() }
            .show()
    }

    /** «Главы»: «время · название», the current one checked; a choice seeks to its start. */
    private fun openChapters(item: Int, now: Long) {
        val list = skips.chapters(item)
        if (list.isEmpty() || item != index()) return
        dialog = AlertDialog.Builder(this, R.style.OmpPlayerDialog)
            .setTitle("Главы")
            .setSingleChoiceItems(Chapters.rows(list).toTypedArray(), Chapters.indexAt(list, now)) { d, n ->
                d.dismiss()
                if (item == index()) {
                    seekToMs(list[n].startMs)
                    showControls()
                    changed()
                }
            }
            .show()
    }

    /** «Отметить …»: the page applies the mark (applyMark), saves it and answers with a message and new segments. */
    private fun emitMark(item: Int, kind: String, nowMs: Long, durMs: Long) {
        if (closedSent) return
        val o = JSObject()
        session?.let { o.put("session", it) }
        o.put("index", item)
        o.put("kind", kind)
        o.put("now", nowMs / 1000.0)
        o.put("duration", durMs / 1000.0)
        NativePlayerBridge.emit("nativePlayerMark", o)
    }

    // ---- keys ----

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code == KeyEvent.KEYCODE_BACK || code !in HANDLED_KEYS) return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_DOWN) onKey(code)
        return true
    }

    private fun onKey(code: Int) {
        when (code) {
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> when {
                countdown >= 0 -> playNext()
                error != null -> retry()
                undoStart != null -> undoSkip()
                skipShown() -> skipIntro()
                else -> togglePause()
            }
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE -> togglePause()
            KeyEvent.KEYCODE_MEDIA_PLAY -> if (!exo.playWhenReady) togglePause()
            KeyEvent.KEYCODE_MEDIA_PAUSE -> if (exo.playWhenReady) togglePause()
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> seekBy(-1)
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> seekBy(1)
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_MENU -> openMenu()
            KeyEvent.KEYCODE_DPAD_DOWN -> showControls()
            KeyEvent.KEYCODE_MEDIA_NEXT -> playNext()
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> playPrev()
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> chapterKey(1)
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> chapterKey(-1)
            KeyEvent.KEYCODE_MEDIA_STOP -> close()
        }
    }

    private fun onBack() {
        if (countdown >= 0) {
            if (creditsCountdown) skips.dismissCountdown()
            cancelCountdown()
            showControls()
            return
        }
        if (undoStart != null) {
            hideMessage()
            return
        }
        if (skipShown()) {
            skips.hideIntro(index())
            render()
            return
        }
        close()
    }

    // ---- chapters and skips (from the page: NativePlayerBridge.segments) ----

    /**
     * Takes the messages the page sent (the first ones can arrive before the player is created). While a replacing
     * queue is on its way (playNative set a new request, onNewIntent has not loaded it yet) they stay queued:
     * load() takes them with the new queue.
     */
    fun applySkips() {
        if (!::exo.isInitialized || isFinishing || NativePlayerBridge.request !== req) return
        NativePlayerBridge.takeSkips().forEach { if (it.index < req.queue.size) skips.set(it) }
        checkSkips()
        render()
    }

    /** «Пропустить заставку» is on screen: inside the intro, not skipped or hidden, no countdown / «Вернуть». */
    private fun skipShown(): Boolean =
        ::exo.isInitialized && countdown < 0 && error == null && !isFinishing && undoStart == null &&
            skips.skipDue(index(), exo.currentPosition)

    private fun skipIntro() {
        val i = index()
        val t = skips.introTarget(i, durationMs()) ?: return
        skips.hideIntro(i)
        seekToMs(t)
        changed()
    }

    /** «Вернуть»: back to the start of the intro that was skipped automatically (not skipped again in this file). */
    private fun undoSkip() {
        val t = undoStart ?: return
        hideMessage()
        seekToMs(t)
        showControls()
        changed()
    }

    /**
     * On every position tick: auto skip of the intro, credits auto skip to the next item («Титры пропущены»,
     * regardless of autoNext), the «Следующая серия» countdown from the credits start (with autoNext).
     */
    private fun checkSkips() {
        if (!::exo.isInitialized || isFinishing || error != null || seeker.pending() != null) return
        if (exo.currentMediaItemIndex != lastIndex) return // the transition has not been handled yet
        val i = index()
        val pos = exo.currentPosition
        val dur = durationMs()
        if (creditsCountdown && !skips.countdownHolds(i, pos, dur, exo.playWhenReady)) cancelCountdown()
        val start = skips.info(i)?.intro?.startMs
        val auto = skips.autoIntro(i, pos, dur)
        if (auto != null && start != null) {
            seekToMs(auto)
            showMessage(getString(R.string.player_intro_skipped), false, undo = start)
            emitState()
            return
        }
        if (skips.creditsCrossed(i, pos, exo.playWhenReady, hasNext())) {
            playNext()
            showMessage(getString(R.string.player_credits_skipped), false)
            return
        }
        if (countdown < 0 && req.autoNext && hasNext() && exo.playWhenReady && skips.countdownDue(i, pos, dur)) {
            countdown = CREDITS_COUNTDOWN_S
            creditsCountdown = true
            handler.removeCallbacks(countdownTick)
            handler.postDelayed(countdownTick, 1000)
        }
    }

    /** CH+ / CH−: the next / previous chapter; without chapters the next / previous episode (once ffprobe answered). */
    private fun chapterKey(dir: Int) {
        showControls()
        when (val step = skips.chapterStep(index(), seeker.pending() ?: exo.currentPosition, dir)) {
            is ChapterStep.Seek -> {
                seekToMs(step.ms)
                changed()
            }
            ChapterStep.NextItem -> playNext()
            ChapterStep.PrevItem -> playPrev()
            ChapterStep.Wait, ChapterStep.None -> Unit
        }
    }

    /** A message at the top left: «Заставка пропущена» with «Вернуть · OK» for 5 s ([undo]), others for 3 s. */
    fun showMessage(text: String, error: Boolean, undo: Long? = null) {
        if (!::exo.isInitialized || isFinishing) return
        undoStart = undo
        toastText.text = text
        toastText.setTextColor(if (error) ERROR_COLOR else TEXT_COLOR)
        toastShown = true
        handler.removeCallbacks(hideToast)
        handler.postDelayed(hideToast, if (undo != null) SKIP_TOAST_MS else MESSAGE_MS)
        render()
    }

    private fun hideMessage() {
        handler.removeCallbacks(hideToast)
        undoStart = null
        toastShown = false
        if (::toastBox.isInitialized) render()
    }

    private fun togglePause() {
        if (exo.playWhenReady) {
            // the credits countdown waits for playback (shown again on play, as on LG)
            if (creditsCountdown) cancelCountdown()
            exo.pause()
        } else {
            exo.play()
        }
        showControls()
        changed()
    }

    private fun seekBy(dir: Int) {
        val dur = durationMs()
        seeker.press(dir, exo.currentPosition, dur, req.seekStep)
        handler.removeCallbacks(commitSeek)
        handler.postDelayed(commitSeek, SeekAccumulator.COMMIT_DELAY_MS)
        showControls()
    }

    private fun seekToMs(t: Long) {
        handler.removeCallbacks(commitSeek)
        seeker.cancel()
        skips.seeked()
        exo.seekTo(t)
    }

    private fun playNext() {
        cancelCountdown()
        if (hasNext()) {
            exo.seekToDefaultPosition(index() + 1)
            exo.play()
        }
    }

    private fun playPrev() {
        cancelCountdown()
        if (index() > 0) {
            exo.seekToDefaultPosition(index() - 1)
            exo.play()
        }
    }

    private fun retry() {
        error = null
        exo.prepare()
        exo.play()
        changed()
    }

    private fun onItemEnd() {
        if (isFinishing) return
        // a credits countdown still running at the end (short credits) gives way to the end-of-item one
        // (it would be cancelled anyway: the player pauses at the end)
        if (creditsCountdown) cancelCountdown()
        if (countdown >= 0) return
        if (hasNext() && req.autoNext) {
            countdown = NEXT_COUNTDOWN_S
            handler.removeCallbacks(countdownTick)
            handler.postDelayed(countdownTick, 1000)
            render()
        } else {
            close()
        }
    }

    private fun cancelCountdown() {
        countdown = -1
        creditsCountdown = false
        handler.removeCallbacks(countdownTick)
        if (::nextBox.isInitialized) nextBox.visibility = View.GONE
    }

    /** A seek still being collected is applied first, so that the reported position is where the user went. */
    private fun commitPendingSeek() {
        handler.removeCallbacks(commitSeek)
        seeker.take()?.let { exo.seekTo(it) }
    }

    /**
     * Item change: the item left keeps its position as the resume point (cleared when nearly finished, as
     * resumePosition does), the new item starts from its own resume point.
     */
    private fun resumeItem() {
        val i = index()
        if (lastIndex in resumeMs.indices && lastIndex != i) {
            val watched = lastDurMs > 0 && lastPosMs.toDouble() / lastDurMs >= WATCHED_RATIO
            resumeMs[lastIndex] = if (watched || lastPosMs < MIN_RESUME_MS) 0L else lastPosMs
        }
        lastIndex = i
        val r = resumeMs.getOrElse(i) { 0L }
        if (r > 0 && exo.currentPosition < MIN_RESUME_MS) exo.seekTo(r)
    }

    private fun close() {
        if (isFinishing) return
        emitClosed(replaced = false)
        finish()
    }

    // ---- phone remote (control/TvRemote.kt), UI thread ----

    /** A key from the phone remote (UP/DOWN/LEFT/RIGHT/ENTER/BACK) handled like the TV remote's key. */
    fun remoteKey(name: String) {
        if (isFinishing || !::exo.isInitialized) return
        val code = when (name) {
            "UP" -> KeyEvent.KEYCODE_DPAD_UP
            "DOWN" -> KeyEvent.KEYCODE_DPAD_DOWN
            "LEFT" -> KeyEvent.KEYCODE_DPAD_LEFT
            "RIGHT" -> KeyEvent.KEYCODE_DPAD_RIGHT
            "ENTER" -> KeyEvent.KEYCODE_DPAD_CENTER
            "BACK" -> KeyEvent.KEYCODE_BACK
            else -> return
        }
        badge.visibility = View.VISIBLE
        if (dialog?.isShowing == true) {
            // the track list moves its own focus: a real key event into our window (off the UI thread)
            Thread {
                try {
                    Instrumentation().sendKeyDownUpSync(code)
                } catch (_: RuntimeException) {
                }
            }.start()
            return
        }
        if (code == KeyEvent.KEYCODE_BACK) onBack() else onKey(code)
    }

    /** «Каталог» or a navigating launch from the phone: the player closes (nativePlayerClosed first). */
    fun closeFromRemote() {
        if (::exo.isInitialized) commitPendingSeek()
        close()
    }

    // ---- phone commands (src/phone/protocol.ts Cmd) ----

    fun applyCommand(cmd: JSONObject) {
        if (isFinishing || !::exo.isInitialized) return
        badge.visibility = View.VISIBLE
        val dur = durationMs()
        when (cmd.optString("type")) {
            "play" -> if (!exo.playWhenReady) exo.play()
            "pause" -> if (exo.playWhenReady) exo.pause()
            "seek" -> if (dur > 0) seekToMs((cmd.optDouble("t", 0.0) * 1000).toLong().coerceIn(0L, dur))
            "skip" -> if (dur > 0) seekToMs((exo.currentPosition + (cmd.optDouble("d", 0.0) * 1000).toLong()).coerceIn(0L, dur))
            "next" -> playNext()
            "prev" -> playPrev()
            "audio" -> selectAudio(cmd.optInt("i", -1))
            "subs" -> selectSub(cmd.optString("value"))
        }
        changed()
    }

    // ---- overlay ----

    private fun showControls() {
        controlsShown = true
        handler.removeCallbacks(hideControls)
        handler.postDelayed(hideControls, HIDE_MS)
        render()
    }

    private fun render() {
        if (!::exo.isInitialized || isDestroyed) return
        val i = index()
        val item = req.queue[i]
        val dur = durationMs()
        val pos = seeker.pending() ?: exo.currentPosition
        val paused = !exo.playWhenReady
        val visible = controlsShown || paused || seeker.pending() != null || error != null
        controls.visibility = if (visible) View.VISIBLE else View.GONE
        if (visible) {
            title.text = item.title
            progress.progress = if (dur > 0) (pos * 1000 / dur).toInt().coerceIn(0, 1000) else 0
            time.text = clock(pos) + " / " + clock(dur)
            btnPause.setText(if (paused) R.string.player_play else R.string.player_pause)
            val audio = audioOptions()
            btnAudio.text = "Аудио: " + (audio.getOrNull(selectedAudio(audio))?.label ?: "по умолчанию")
            btnSubs.text = "Субтитры: " + selectedSub(subOptions()).label
            btnNext.visibility = if (hasNext()) View.VISIBLE else View.GONE
            val chapters = skips.chapters(i)
            if (chapters.isNotEmpty()) {
                val cur = Chapters.current(chapters, pos)
                if (cur.isNotEmpty()) title.text = item.title + " · " + cur
            }
            ticksView.setTicks(Chapters.ticks(chapters, dur))
            hint.setText(if (chapters.isNotEmpty()) R.string.player_hint_chapters else R.string.player_hint)
        }
        toastBox.visibility = if (toastShown) View.VISIBLE else View.GONE
        toastUndo.visibility = if (undoStart != null) View.VISIBLE else View.GONE
        btnSkip.visibility = if (skipShown()) View.VISIBLE else View.GONE
        // above the controls while they are shown, near the bottom edge when they are hidden
        btnSkip.translationY = if (visible) 0f else SKIP_HIDDEN_SHIFT_DP * resources.displayMetrics.density
        buffering.visibility = if (exo.playbackState == Player.STATE_BUFFERING && error == null) View.VISIBLE else View.GONE
        if (countdown >= 0 && hasNext()) {
            nextBox.visibility = View.VISIBLE
            nextCount.text = "Следующая серия через $countdown"
            nextTitle.text = req.queue[i + 1].title
        } else {
            nextBox.visibility = View.GONE
        }
        val e = error
        errorBox.visibility = if (e != null) View.VISIBLE else View.GONE
        if (e != null) errorText.text = e
    }

    // ---- events to the page ----

    private fun emitState() {
        if (!::exo.isInitialized || closedSent) return
        val audio = audioOptions()
        val subs = subOptions()
        val aList = JSArray()
        audio.forEach { aList.put(it.label) }
        val sList = JSArray()
        subs.forEach { sList.put(JSObject().put("label", it.label).put("value", it.value)) }
        val o = base()
        o.put("paused", !exo.playWhenReady || error != null)
        o.put("buffering", exo.playbackState == Player.STATE_BUFFERING)
        o.put("audio", JSObject().put("list", aList).put("sel", selectedAudio(audio)))
        o.put("subs", JSObject().put("list", sList).put("sel", selectedSub(subs).value))
        NativePlayerBridge.emit("nativePlayerState", o)
    }

    private fun emitClosed(replaced: Boolean) {
        if (closedSent || !::exo.isInitialized) return
        closedSent = true
        commitPendingSeek()
        val o = base()
        if (replaced) o.put("replaced", true)
        NativePlayerBridge.emit("nativePlayerClosed", o)
    }

    private fun base(): JSObject {
        val o = JSObject()
        session?.let { o.put("session", it) }
        o.put("index", index())
        o.put("time", exo.currentPosition.coerceAtLeast(0L) / 1000.0)
        o.put("duration", durationMs() / 1000.0)
        return o
    }

    companion object {
        private const val HIDE_MS = 4000L
        private const val WATCHED_RATIO = 0.9
        private const val MIN_RESUME_MS = 10_000L
        private const val NEXT_COUNTDOWN_S = 5
        private const val CREDITS_COUNTDOWN_S = 10
        private const val SKIP_HIDDEN_SHIFT_DP = 150f
        /** «Заставка пропущена · Вернуть» (SKIP_TOAST_MS of src/player/chapters.ts), other messages. */
        private const val SKIP_TOAST_MS = 5000L
        private const val MESSAGE_MS = 3000L
        private const val TEXT_COLOR = 0xFFE8EAF0.toInt()
        private const val ERROR_COLOR = 0xFFFF8A80.toInt()
        private const val EXTERNAL_ID = "omp-x"
        private val EXTERNAL_RE = Regex("omp-x(\\d+)")
        private val RU = Locale.forLanguageTag("ru")

        private val HANDLED_KEYS = setOf(
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_MEDIA_PLAY,
            KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND,
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_MEDIA_NEXT,
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_CHANNEL_DOWN,
            KeyEvent.KEYCODE_MEDIA_STOP, KeyEvent.KEYCODE_PAGE_UP, KeyEvent.KEYCODE_PAGE_DOWN,
        )

        fun subMime(ext: String): String? = when (ext.lowercase(Locale.ROOT).trimStart('.')) {
            "srt" -> MimeTypes.APPLICATION_SUBRIP
            "ass", "ssa" -> MimeTypes.TEXT_SSA
            "vtt" -> MimeTypes.TEXT_VTT
            else -> null
        }

        /** user:password@ from the URL → Authorization: Basic, the URL without credentials. */
        fun withBasicAuth(spec: DataSpec): DataSpec {
            val uri = spec.uri
            val info = uri.encodedUserInfo
            val authority = uri.encodedAuthority
            if (info.isNullOrEmpty() || authority == null) return spec
            val user = Uri.decode(info.substringBefore(':'))
            val pass = Uri.decode(info.substringAfter(':', ""))
            val clean = uri.buildUpon().encodedAuthority(authority.substringAfter('@')).build()
            val token = Base64.encodeToString("$user:$pass".toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            val headers = HashMap(spec.httpRequestHeaders)
            headers["Authorization"] = "Basic $token"
            return spec.buildUpon().setUri(clean).setHttpRequestHeaders(headers).build()
        }

        fun clock(ms: Long): String = formatClock(ms)

        private fun language(code: String?): String {
            if (code.isNullOrEmpty() || code == C.LANGUAGE_UNDETERMINED) return ""
            val name = Locale.forLanguageTag(code).getDisplayLanguage(RU)
            if (name.isEmpty() || name.equals(code, ignoreCase = true)) return ""
            return name.replaceFirstChar { it.titlecase(RU) }
        }

        private fun codec(f: Format): String = when (f.sampleMimeType) {
            MimeTypes.AUDIO_AC3 -> "AC3"
            MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC -> "E-AC3"
            MimeTypes.AUDIO_AC4 -> "AC4"
            MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD, MimeTypes.AUDIO_DTS_EXPRESS -> "DTS"
            MimeTypes.AUDIO_TRUEHD -> "TrueHD"
            MimeTypes.AUDIO_AAC -> "AAC"
            MimeTypes.AUDIO_MPEG, MimeTypes.AUDIO_MPEG_L2 -> "MP3"
            MimeTypes.AUDIO_OPUS -> "Opus"
            MimeTypes.AUDIO_FLAC -> "FLAC"
            MimeTypes.AUDIO_VORBIS -> "Vorbis"
            else -> ""
        }

        private fun channels(n: Int): String = when (n) {
            1 -> "1.0"
            2 -> "2.0"
            6 -> "5.1"
            8 -> "7.1"
            Format.NO_VALUE -> ""
            else -> n.toString() + " кан."
        }

        /** «Русский · Дубляж · AC3 5.1» (empty parts left out). */
        fun audioLabel(f: Format, n: Int): String {
            val tech = listOf(codec(f), channels(f.channelCount)).filter { it.isNotEmpty() }.joinToString(" ")
            val parts = ArrayList<String>()
            for (p in listOf(language(f.language), f.label.orEmpty(), tech)) if (p.isNotEmpty() && p !in parts) parts.add(p)
            return if (parts.isEmpty()) "Дорожка $n" else parts.joinToString(" · ")
        }

        fun subLabel(f: Format, n: Int): String {
            val parts = ArrayList<String>()
            for (p in listOf(language(f.language), f.label.orEmpty())) if (p.isNotEmpty() && p !in parts) parts.add(p)
            return if (parts.isEmpty()) "Субтитры $n" else parts.joinToString(" · ")
        }

        fun describe(e: PlaybackException): String = when (e.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            PlaybackException.ERROR_CODE_TIMEOUT -> "Сервер недоступен или не отвечает"
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED -> "Формат видео не поддерживается"
            else -> "Не удалось воспроизвести видео"
        }
    }
}
