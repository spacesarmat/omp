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
 * OK pause, ▲ tracks, Back closes. At the end of an item: «Следующая серия через N» (5 s) or close.
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
    private lateinit var errorBox: View
    private lateinit var errorText: TextView

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

    private val hideControls = Runnable {
        controlsShown = false
        render()
    }
    private val commitSeek = Runnable {
        val t = seeker.take()
        if (t != null) exo.seekTo(t)
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
        errorBox = findViewById(R.id.player_error)
        errorText = findViewById(R.id.player_error_text)

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

    private fun openTracks() {
        if (dialog?.isShowing == true) return
        showControls()
        val audio = audioOptions()
        val subs = subOptions()
        val aSel = selectedAudio(audio)
        val sSel = selectedSub(subs)
        val root = arrayOf(
            "Аудио: " + (audio.getOrNull(aSel)?.label ?: "по умолчанию"),
            "Субтитры: " + sSel.label,
        )
        dialog = AlertDialog.Builder(this, R.style.OmpPlayerDialog)
            .setTitle("Дорожки")
            .setItems(root) { _, which ->
                if (which == 0) {
                    if (audio.size < 2) return@setItems
                    dialog = AlertDialog.Builder(this, R.style.OmpPlayerDialog)
                        .setTitle("Аудио")
                        .setSingleChoiceItems(audio.map { it.label }.toTypedArray(), aSel) { d, i ->
                            d.dismiss()
                            selectAudio(i)
                        }
                        .show()
                } else {
                    dialog = AlertDialog.Builder(this, R.style.OmpPlayerDialog)
                        .setTitle("Субтитры")
                        .setSingleChoiceItems(subs.map { it.label }.toTypedArray(), subs.indexOf(sSel)) { d, i ->
                            d.dismiss()
                            selectSub(subs[i].value)
                        }
                        .show()
                }
            }
            .show()
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
                else -> togglePause()
            }
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE -> togglePause()
            KeyEvent.KEYCODE_MEDIA_PLAY -> if (!exo.playWhenReady) togglePause()
            KeyEvent.KEYCODE_MEDIA_PAUSE -> if (exo.playWhenReady) togglePause()
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> seekBy(-1)
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> seekBy(1)
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_MENU -> openTracks()
            KeyEvent.KEYCODE_DPAD_DOWN -> showControls()
            KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_CHANNEL_UP -> playNext()
            KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_CHANNEL_DOWN -> playPrev()
            KeyEvent.KEYCODE_MEDIA_STOP -> close()
        }
    }

    private fun onBack() {
        if (countdown >= 0) {
            cancelCountdown()
            showControls()
            return
        }
        close()
    }

    private fun togglePause() {
        if (exo.playWhenReady) exo.pause() else exo.play()
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
        if (countdown >= 0 || isFinishing) return
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
        }
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
            KeyEvent.KEYCODE_MEDIA_STOP,
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

        fun clock(ms: Long): String {
            val sec = (ms.coerceAtLeast(0L) / 1000)
            val h = sec / 3600
            val m = sec / 60 % 60
            val s = sec % 60
            return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s)
            else String.format(Locale.ROOT, "%d:%02d", m, s)
        }

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
