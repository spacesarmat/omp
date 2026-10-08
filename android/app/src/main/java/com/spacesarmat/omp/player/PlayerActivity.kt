package com.spacesarmat.omp.player

import com.spacesarmat.omp.I18n

import android.app.Instrumentation
import android.content.DialogInterface
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.os.Bundle
import android.text.Spannable
import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import android.graphics.Typeface
import android.text.style.ForegroundColorSpan
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.spacesarmat.omp.R
import com.spacesarmat.omp.control.AppForeground
import org.json.JSONObject

/**
 * Native player on Android TV (2160 Player's engine or libVLC) with the OMP overlay: title, progress, time, «Пауза»,
 * «Аудио: …», «Субтитры: …», «Следующая серия», key hints and the «Управление с телефона» badge.
 * Keys: ◀/▶ seek by the settings step with the LG arrow rule ([SeekAccumulator]: ×(1 + repeats/4) up to ×6,
 * one seek 700 ms after the last press),
 * OK pause, ▲ / Menu the player menu (tracks, «Главы», «Отметить …»), CH+ / CH− (Page Up / Down) the next /
 * previous chapter (episode when the file has none), ⏭ / ⏮ the next / previous episode, Back closes.
 * At the end of an item: «Следующая серия через N» (5 s) or close; with known credits the countdown starts there.
 * Chapters and skips come from the page per item ([SkipState]): ticks, «Пропустить заставку», auto skip of the
 * intro with «Вернуть», credits auto skip to the next item (as the LG player).
 * «Поддержать» ([DonateQr], sent with playNative): a QR card on pause and during the credits, purely visual.
 * Moving to another item starts it from its resume point (queue `resume`, updated when an item is left).
 * Events go to the page through [NativePlayerBridge]. Playback goes through a [PlayerEngine] ([Engine2160] or
 * [VlcEngine], picked by [EngineChooser]: «Плеер» setting / the torrent's choice, «Авто» moves to VLC on a format
 * error before the first frame or ASS subtitles) driven by [PlayerSession] (queue, resume points, error, tracks).
 */
class PlayerActivity : AppCompatActivity(), PlayerSession.Ui {
    private lateinit var session: PlayerSession
    /** The engine playing now (the session may switch it). */
    private val engine: PlayerEngine get() = session.engine
    private val flow = PlayerFlow()
    /** One LibVLC for all VLC engines of this activity (released in onDestroy, after them). */
    private val vlcLibrary by lazy { VlcLibrary(this) }
    private lateinit var switcher: EngineSwitcher
    private val dedupe = StateDeduper()
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
    private lateinit var donateBox: View
    private lateinit var donateQrView: ImageView
    private lateinit var donateTitle: TextView
    private lateinit var donateText: TextView
    private lateinit var donateLink: TextView
    private lateinit var engineName: TextView
    private lateinit var infoView: View

    /** The three tiles of «Инфо»: label and value views. */
    private val infoTiles = ArrayList<Pair<TextView, TextView>>()

    /** «Инфо» is on screen (Info key; Back closes it; playback goes on). */
    private var infoShown = false

    /** The TorrServer statistics of the torrent playing (InfoStatsState), and whether a request is out. */
    private val infoStats = InfoStatsState()
    private var infoFetching = false

    /** «Инфо» refresh: once a second while shown (TorrServer asked in the background). */
    private val infoTick = object : Runnable {
        override fun run() {
            if (!infoShown) return
            fetchInfoStats()
            renderInfo()
            handler.postDelayed(this, INFO_REFRESH_MS)
        }
    }
    /** The page said a support code is known: no card for the rest of this run. */
    private var donateHidden = false
    private var donateShown = DonateQr.NONE

    private var runId: Long? = null
    private var closedSent = false
    private var controlsShown = true
    private val seeker = SeekAccumulator({ SystemClock.uptimeMillis() })
    private var ticks = 0
    private var dialog: AlertDialog? = null

    /** The colour key whose window [dialog] is (audio list, subtitles list, menu); null for another list. */
    private var dialogKey: ColorAction? = null
    private val skips = SkipState()
    /** «Заставка пропущена · Вернуть» on screen: the intro start OK returns to. */
    private var undoStart: Long? = null

    private var toastShown = false
    private val hideToast = Runnable {
        undoStart = null
        toastShown = false
        render()
    }
    /** The phone badge fades out BADGE_MS after the last phone command (it never stays on screen). */
    private val hideBadge = Runnable {
        badge.animate().cancel()
        badge.animate().alpha(0f).setDuration(BADGE_FADE_MS).withEndAction { badge.visibility = View.GONE }.start()
    }
    private val hideControls = Runnable {
        controlsShown = false
        render()
    }
    private val commitSeek = Runnable {
        val t = seeker.take()
        if (t != null) {
            skips.seeked()
            flow.moved()
            engine.seekTo(t)
        }
        render()
        emitState()
    }
    private val countdownTick = object : Runnable {
        override fun run() {
            if (flow.countdown < 0) return
            if (flow.second()) playNext() else {
                render()
                handler.postDelayed(this, 1000)
            }
        }
    }
    private val tick = object : Runnable {
        override fun run() {
            session.tick()
            checkVlcStart()
            checkSkips()
            preloadNext()
            render()
            if (++ticks % 2 == 0) emitState()
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        I18n.load(this)
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
        donateBox = findViewById(R.id.player_donate)
        donateQrView = findViewById(R.id.player_donate_qr)
        donateTitle = findViewById(R.id.player_donate_title)
        donateText = findViewById(R.id.player_donate_text)
        donateLink = findViewById(R.id.player_donate_link)
        engineName = findViewById(R.id.player_engine)
        infoView = findViewById(R.id.player_info)
        buildInfoTiles()
        findViewById<TextView>(R.id.player_badge).text = I18n.s("player.res.phoneBadge")
        btnNext.text = I18n.s("player.res.next")
        btnSkip.text = I18n.s("player.res.skipIntro")
        findViewById<TextView>(R.id.player_toast_undo).text = I18n.s("player.res.undoSkip")
        donateQrView.contentDescription = I18n.s("player.res.donateQr")
        findViewById<TextView>(R.id.player_next_hint).text = I18n.s("player.res.nextHint")
        findViewById<TextView>(R.id.player_error_hint).text = I18n.s("player.res.errorHint")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = onBack()
        })
        switcher = EngineSwitcher(engineHost, VlcAvailability.available(this))
        session = PlayerSession(switcher.firstEngine(r), this)
        switcher.session = session
        NativePlayerBridge.player = this
        load(r, choose = false)
    }

    override fun onStart() {
        super.onStart()
        handler.removeCallbacks(tick)
        if (::session.isInitialized) {
            engine.hostStarted()
            handler.post(tick)
            if (infoShown) handler.post(infoTick)
        }
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
        handler.removeCallbacks(infoTick)
        if (::session.isInitialized) {
            if (!isFinishing) engine.pause()
            engine.hostStopped()
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        dialog?.dismiss()
        if (::session.isInitialized) {
            emitClosed(replaced = false)
            engine.release()
            // queued on the libVLC thread after the engine's own release
            vlcLibrary.release()
        }
        if (NativePlayerBridge.player === this) NativePlayerBridge.player = null
        super.onDestroy()
    }

    // ---- player ----

    override fun changed() {
        render()
        emitState()
    }

    override fun itemEnded() = onItemEnd()

    /** A new queue; [choose]: pick the engine for it (onCreate already did). */
    private fun load(r: PlayRequest, choose: Boolean = true) {
        // a new run picks its engine again (the setting or the torrent's choice may differ)
        val next = if (choose) switcher.engineForRun(r) else null
        // the session first: everything below may render, and render reads the queue and index from it
        session.load(r, next)
        flow.reset()
        dedupe.reset()
        cancelCountdown()
        handler.removeCallbacks(commitSeek)
        seeker.cancel()
        closedSent = false
        runId = r.session
        skips.clear()
        hideMessage()
        setDonate(r.donate)
        applySkips()
        showControls()
    }

    private fun index(): Int = session.index

    // ---- engines (decisions: EngineSwitcher) ----

    private val engineHost = object : EngineSwitcher.Host {
        override val finishing: Boolean get() = isFinishing || isDestroyed

        override fun create(kind: EngineKind): PlayerEngine? {
            val e: PlayerEngine = if (kind == EngineKind.VLC) {
                try {
                    VlcEngine(vlcLibrary)
                } catch (t: Throwable) {
                    Log.w(TAG, "VLC failed to start: " + t.javaClass.simpleName)
                    return null
                }
            } else {
                Engine2160(this@PlayerActivity)
            }
            e.attach(findViewById<ViewGroup>(R.id.player_video))
            return e
        }

        override fun post(block: () -> Unit) {
            handler.post(block)
        }

        override fun assSubs(r: PlayRequest, index: Int): Boolean =
            r.queue.getOrNull(index)?.assSubs == true || NativePlayerBridge.assSubs(index)

        override fun beforeSwitch() = commitPendingSeek()

        override fun switched(kind: EngineKind, reason: SwitchReason) {
            if (reason == SwitchReason.FORMAT) showMessage(EngineChooser.FORMAT_SWITCH_TEXT, false)
            emitEngine(kind, reason)
            showControls()
            changed()
        }

        override fun message(text: String) = showMessage(text, false)
    }

    private val vlcStart = VlcStartWatch()

    /** VLC meant to play that does not get going in 20 s: «VLC не справляется» with «Вернуться к встроенному» / «Ждать». */
    private fun checkVlcStart() {
        if (!::switcher.isInitialized) return
        val e = engine
        val vlc = switcher.kind == EngineKind.VLC
        val playing = vlc && e.playWhenReady && session.error == null && dialog?.isShowing != true
        val due = vlcStart.tick(playing, Pair(e, session.index), e.positionMs, SystemClock.elapsedRealtime())
        // the engine left VLC (a switch, a new run) or VLC got going: the prompt goes away, never over working playback
        val open = vlcPrompt
        if (open != null && (!open.isShowing || vlcStart.promptStale(vlc))) {
            if (open.isShowing) open.dismiss()
            vlcPrompt = null
        }
        if (!due) return
        Log.w(TAG, "VLC has not started in ${VlcStartWatch.LIMIT_MS / 1000} s")
        val prompt = AlertDialog.Builder(this, R.style.OmpPlayerDialog)
            .setTitle(I18n.s("player.vlcStuck"))
            .setPositiveButton(I18n.s("player.vlcStuckBack")) { d, _ ->
                d.dismiss()
                switcher.backToBuiltin()
            }
            .setNegativeButton(I18n.s("player.vlcStuckWait")) { d, _ ->
                d.dismiss()
                vlcStart.waitMore()
            }
            .setOnCancelListener { vlcStart.waitMore() }
            .show()
        // OK on the remote goes back to the built-in player: it is the one that plays
        prompt.getButton(DialogInterface.BUTTON_POSITIVE)?.requestFocus()
        dialog = prompt
        vlcPrompt = prompt
    }

    /** The open «VLC не справляется» prompt; null when none. */
    private var vlcPrompt: AlertDialog? = null

    override fun engineFailed(kind: ErrorKind, detail: String, beforeFirstFrame: Boolean): Boolean =
        ::switcher.isInitialized && switcher.engineFailed(kind, detail, beforeFirstFrame)

    /** { type: "assSubs" } from the page: «Авто» moves the current item to VLC (other items: when they start). */
    fun assSubsKnown(i: Int) {
        if (isFinishing || !::session.isInitialized) return
        switcher.assSubsKnown(i)
    }

    /**
     * nativePlayerTrack { session, index, kind: "audio", label, lang, channels, seen: [{ l, g, c }] } or
     * { session, index, kind: "subs", off, label?, lang? }: a track picked by hand, remembered by the page for the
     * whole series («Озвучка»).
     */
    override fun trackChosen(choice: TrackChoice) {
        if (closedSent) return
        val o = JSObject()
        runId?.let { o.put("session", it) }
        o.put("index", index())
        o.put("kind", if (choice.audio) "audio" else "subs")
        if (!choice.audio) o.put("off", choice.off)
        if (!choice.off) {
            o.put("label", choice.label)
            o.put("lang", choice.lang)
        }
        if (choice.audio) {
            if (choice.channels > 0) o.put("channels", choice.channels)
            val seen = JSArray()
            choice.seen.forEach { d ->
                val s = JSObject()
                s.put("l", d.label)
                s.put("g", d.lang)
                if (d.channels > 0) s.put("c", d.channels)
                seen.put(s)
            }
            o.put("seen", seen)
        }
        NativePlayerBridge.emit("nativePlayerTrack", o)
    }

    /** nativePlayerEngine { session, index, engine: "builtin" | "vlc", reason }: the page logs / remembers it. */
    private fun emitEngine(kind: EngineKind, reason: SwitchReason) {
        if (closedSent) return
        val o = JSObject()
        runId?.let { o.put("session", it) }
        o.put("index", index())
        o.put("engine", kind.wire)
        o.put("reason", reason.wire)
        NativePlayerBridge.emit("nativePlayerEngine", o)
    }

    private fun hasNext(): Boolean = session.hasNext()

    private fun durationMs(): Long = engine.durationMs

    private fun selectedAudioLabel(audio: List<AudioOption>): String =
        audio.getOrNull(TrackOptions.selectedAudio(audio))?.label ?: I18n.s("player.default")

    /**
     * «Меню плеера»: «Аудио», «Субтитры», «Ночной звук» (engines that have it), «Главы» (when the file has chapters)
     * and the three «Отметить …» rows (as on LG). The marks use the position at the time the menu opened.
     */
    private fun openMenu() {
        if (dialog?.isShowing == true) return
        showControls()
        val i = index()
        val now = (seeker.pending() ?: engine.positionMs).coerceAtLeast(0L)
        val dur = durationMs()
        val audio = session.audioOptions()
        val subs = session.subOptions()
        val sSel = TrackOptions.selectedSub(subs)
        val chapters = skips.chapters(i)
        val rows = ArrayList<Pair<String, () -> Unit>>()
        rows.add(switcher.menuRow() to { switcher.menuPressed() })
        rows.add(I18n.s("player.audioRow", "v" to selectedAudioLabel(audio)) to { openAudioList() })
        rows.add(I18n.s("player.subsRow", "v" to sSel.label) to { openSubsList() })
        engine.nightMode?.let { on ->
            rows.add(ColorKeys.nightLabel(on) to { engine.setNightMode(!on) })
        }
        // «Инфо» also from the menu: many box remotes have no Info key, and yellow is night sound with this engine
        rows.add(I18n.s("player.infoRow") to { if (!infoShown) toggleInfo() })
        if (chapters.isNotEmpty()) rows.add(I18n.s("player.chaptersRow", "n" to chapters.size.toString()) to { openChapters(i, now) })
        val marks = markRows(skips.info(i), now, dur)
        listOf("intro-start", "intro-end", "credits").forEachIndexed { n, kind ->
            rows.add(marks[n] to { emitMark(i, kind, now, dur) })
        }
        val menu = withColorKeys(
            AlertDialog.Builder(this, R.style.OmpPlayerDialog)
                .setTitle(I18n.s("player.menu"))
                .setItems(rows.map { it.first }.toTypedArray()) { _, which -> rows.getOrNull(which)?.second?.invoke() }
                .create(),
            ColorAction.MENU,
        )
        menu.show()
        dialog = menu
        dialogKey = ColorAction.MENU
    }

    /** «Главы»: «время · название», the current one checked; a choice seeks to its start. */
    private fun openChapters(item: Int, now: Long) {
        val list = skips.chapters(item)
        if (list.isEmpty() || item != index()) return
        showList(I18n.s("player.chapters"), Chapters.rows(list), Chapters.indexAt(list, now), null) { n ->
            if (item == index()) {
                seekToMs(list[n].startMs)
                showControls()
                changed()
            }
        }
    }

    /** «Аудио» (the menu row, the red key): the tracks, the playing one checked; one track is listed too. */
    private fun openAudioList() {
        val audio = session.audioOptions()
        if (audio.isEmpty()) return
        showList(I18n.s("player.audio"), audio.map { it.label }, TrackOptions.selectedAudio(audio), ColorAction.AUDIO) { n -> session.selectAudio(n) }
    }

    /** «Субтитры» (the menu row, the green key): «Выкл», the tracks and files, the current one checked. */
    private fun openSubsList() {
        val subs = session.subOptions()
        showList(I18n.s("player.subs"), subs.map { it.label }, subs.indexOf(TrackOptions.selectedSub(subs)), ColorAction.SUBS) { n ->
            session.selectSub(subs[n].value)
        }
    }

    /**
     * A single-choice list whose every pick closes it, the checked row included ([ListPick]): the dialog's own item
     * listener is replaced, as the single-choice one of AlertDialog does not close on the checked row everywhere.
     */
    private fun showList(title: String, labels: List<String>, checked: Int, key: ColorAction?, onPick: (Int) -> Unit): AlertDialog {
        val d = AlertDialog.Builder(this, R.style.OmpPlayerDialog)
            .setTitle(title)
            .setSingleChoiceItems(labels.toTypedArray(), checked, null)
            .create()
        withColorKeys(d, key)
        d.show()
        val pick = ListPick(labels.size, { d.dismiss() }, onPick)
        d.listView?.setOnItemClickListener { _, _, n, _ -> pick.click(n) }
        dialog = d
        dialogKey = key
        return d
    }

    /** «Отметить …»: the page applies the mark (applyMark), saves it and answers with a message and new segments. */
    private fun emitMark(item: Int, kind: String, nowMs: Long, durMs: Long) {
        if (closedSent) return
        val o = JSObject()
        runId?.let { o.put("session", it) }
        o.put("index", item)
        o.put("kind", kind)
        o.put("now", nowMs / 1000.0)
        o.put("duration", durMs / 1000.0)
        NativePlayerBridge.emit("nativePlayerMark", o)
    }

    // ---- keys ----

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code == KeyEvent.KEYCODE_BACK || (code !in HANDLED_KEYS && ColorKeys.actionFor(code) == null)) return super.dispatchKeyEvent(event)
        if (event.action != KeyEvent.ACTION_DOWN) return true
        // colour keys and Info once per press: holding Yellow or Info must not flip night sound or «Инфо» at the repeat rate
        if (ColorKeys.actionFor(code) != null && !colorKeyActs(event.repeatCount)) return true
        onKey(code)
        return true
    }

    private fun onKey(code: Int) {
        ColorKeys.actionFor(code)?.let {
            colorKey(it)
            return
        }
        when (code) {
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> when {
                flow.countdown >= 0 -> playNext()
                session.error != null -> retry()
                undoStart != null -> undoSkip()
                skipShown() -> skipIntro()
                else -> togglePause()
            }
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE -> togglePause()
            KeyEvent.KEYCODE_MEDIA_PLAY -> if (!engine.playWhenReady) togglePause()
            KeyEvent.KEYCODE_MEDIA_PAUSE -> if (engine.playWhenReady) togglePause()
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

    /**
     * Colour keys and Info: Red the audio list, Green the subtitles list, Yellow «Ночной звук» (engines that have
     * it; a short label on the overlay), Blue the menu, Info «Инфо».
     */
    private fun colorKey(action: ColorAction) {
        when (action) {
            ColorAction.AUDIO -> openAudioList()
            ColorAction.SUBS -> openSubsList()
            ColorAction.NIGHT -> {
                val on = engine.nightMode
                if (on == null) {
                    showMessage(ColorKeys.nightUnavailable(), false)
                } else {
                    engine.setNightMode(!on)
                    showMessage(ColorKeys.nightLabel(!on), false)
                }
                changed()
            }
            ColorAction.INFO -> toggleInfo()
            ColorAction.MENU -> openMenu()
        }
    }

    /**
     * The colour keys inside a player list or the menu (the dialog has its own window, the activity gets no keys):
     * the dialog closes; its own key only closes it (Red on the audio list), Blue only closes, another key then does
     * its action ([ColorKeys.inDialog]).
     */
    private fun withColorKeys(d: AlertDialog, key: ColorAction?): AlertDialog {
        d.setOnKeyListener { dlg, code, e ->
            val action = ColorKeys.actionFor(code) ?: return@setOnKeyListener false
            if (e.action == KeyEvent.ACTION_DOWN && colorKeyActs(e.repeatCount)) {
                dlg.dismiss()
                ColorKeys.inDialog(action, key)?.let { a -> handler.post { colorKey(a) } }
            }
            true
        }
        return d
    }

    // ---- «Инфо» ----

    /** Shows / hides the «Инфо» panel; it refreshes once a second while shown and never pauses playback. */
    private fun toggleInfo() {
        infoShown = !infoShown
        handler.removeCallbacks(infoTick)
        if (infoShown) {
            infoView.visibility = View.VISIBLE
            handler.post(infoTick)
        } else {
            infoView.visibility = View.GONE
            infoStats.closed()
        }
    }

    /** One /cache request at a time for the torrent of the current item (TorrServerStats); the answer is kept. */
    private fun fetchInfoStats() {
        val r = session.item()?.url?.let { TorrServerStats.request(it) }
        // not a TorrServer stream: no numbers (not the previous item's)
        infoStats.forTorrent(r?.hash, r?.fileKey)
        // ffprobe only when the engine has no bitrate of its own
        if (r != null && r.probeUrl != null && engine.mediaInfo().bitrate <= 0 && infoStats.probeDue()) fetchInfoProbe(r)
        if (r == null || infoFetching) return
        infoFetching = true
        val t = Thread {
            val s = TorrServerStats.fetch(r)
            handler.post {
                infoFetching = false
                // a failed fetch clears the numbers: «нет данных», never frozen ones
                infoStats.answer(r.hash, s)
                if (infoShown) renderInfo()
            }
        }
        t.isDaemon = true
        t.start()
    }

    /**
     * TorrServer's ffprobe of the current file, once per item, in the background (slow on a cold torrent: the tile
     * shows «—» meanwhile, nothing waits for it): the bitrate when the engine reports none, as on LG.
     */
    private fun fetchInfoProbe(r: TorrServerStats.Request) {
        val t = Thread {
            val bps = TorrServerStats.fetchProbeBitrate(r)
            handler.post {
                infoStats.probeAnswer(r.fileKey, bps)
                if (infoShown) renderInfo()
            }
        }
        t.isDaemon = true
        t.start()
    }

    private fun renderInfo() {
        if (!infoShown || !::session.isInitialized || isDestroyed) return
        val item = session.item() ?: return
        val audio = engine.audioTracks().firstOrNull { it.selected }
        val p = PlayerInfoText.panel(
            item.title, engine.mediaInfo(), audio, infoStats.stats,
            probeBps = infoStats.probeBps ?: 0, fileBytes = infoStats.fileBytes, durationMs = durationMs(),
        )
        showInfoPanel(p)
    }

    /** Builds the three tiles of «Инфо» once (layout/player_info_tile.xml), with a gap between them. */
    private fun buildInfoTiles() {
        val row = findViewById<LinearLayout>(R.id.player_info_tiles)
        val gap = (8 * resources.displayMetrics.density).toInt()
        repeat(3) { n ->
            val tile = layoutInflater.inflate(R.layout.player_info_tile, row, false)
            if (n > 0) (tile.layoutParams as LinearLayout.LayoutParams).marginStart = gap
            row.addView(tile)
            infoTiles.add(tile.findViewById<TextView>(R.id.player_info_tile_label) to tile.findViewById(R.id.player_info_tile_value))
        }
        findViewById<TextView>(R.id.player_info_buffer_label).text = I18n.s("info.buffer")
    }

    /** «Инфо» («variant B»): 40% of the screen wide, every text on one line. */
    private fun showInfoPanel(p: InfoPanel) {
        val width = (resources.displayMetrics.widthPixels * INFO_WIDTH).toInt()
        if (infoView.layoutParams.width != width) {
            infoView.layoutParams = infoView.layoutParams.apply { this.width = width }
        }
        findViewById<TextView>(R.id.player_info_title).text = p.title
        val chip = SpannableStringBuilder()
        if (p.hdr.isNotEmpty()) {
            chip.append(p.hdr)
            chip.setSpan(ForegroundColorSpan(INFO_ACCENT), 0, chip.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
            chip.setSpan(StyleSpan(Typeface.BOLD), 0, chip.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
            if (p.chip.isNotEmpty()) chip.append(" · ")
        }
        chip.append(p.chip)
        val chipView = findViewById<TextView>(R.id.player_info_chip)
        chipView.text = chip
        chipView.visibility = if (chip.isEmpty()) View.GONE else View.VISIBLE
        p.tiles.forEachIndexed { n, t ->
            val (label, value) = infoTiles.getOrNull(n) ?: return@forEachIndexed
            label.text = t.label
            val v = SpannableStringBuilder(t.value)
            // an approximate value («≈15»): the mark small and muted, the tile stays one line
            if (t.value.startsWith(PlayerInfoText.APPROX)) {
                val end = PlayerInfoText.APPROX.length
                v.setSpan(RelativeSizeSpan(0.7f), 0, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                v.setSpan(ForegroundColorSpan(INFO_MUTED), 0, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            if (t.unit.isNotEmpty()) {
                val start = v.length
                v.append(" ").append(t.unit)
                v.setSpan(RelativeSizeSpan(0.7f), start, v.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                v.setSpan(ForegroundColorSpan(INFO_MUTED), start, v.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            value.text = v
        }
        val sound = SpannableStringBuilder(I18n.s("info.audio"))
        sound.setSpan(ForegroundColorSpan(INFO_MUTED), 0, sound.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        sound.append("  ").append(p.sound)
        findViewById<TextView>(R.id.player_info_sound).text = sound
        findViewById<ProgressBar>(R.id.player_info_buffer_bar).progress = (p.bufferFill * 1000).toInt()
        findViewById<TextView>(R.id.player_info_buffer).text = p.buffer
    }

    private fun onBack() {
        if (infoShown) {
            toggleInfo()
            return
        }
        if (flow.countdown >= 0) {
            if (flow.creditsCountdown) skips.dismissCountdown()
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
        if (!::session.isInitialized || isFinishing || NativePlayerBridge.request !== req) return
        NativePlayerBridge.takeSkips().forEach { if (it.index < req.queue.size) skips.set(it) }
        checkSkips()
        render()
    }

    /** «Пропустить заставку» is on screen: inside the intro, not skipped or hidden, no countdown / «Вернуть». */
    private fun skipShown(): Boolean =
        ::session.isInitialized && flow.countdown < 0 && session.error == null && !isFinishing && undoStart == null &&
            skips.skipDue(index(), engine.positionMs)

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
        if (!::session.isInitialized || isFinishing || session.error != null || seeker.pending() != null) return
        val i = index()
        val pos = engine.positionMs
        val dur = durationMs()
        if (flow.creditsCountdown && !skips.countdownHolds(i, pos, dur, engine.playWhenReady)) cancelCountdown()
        val start = skips.info(i)?.intro?.startMs
        val auto = skips.autoIntro(i, pos, dur)
        if (auto != null && start != null) {
            seekToMs(auto)
            showMessage(I18n.s("player.res.introSkipped"), false, undo = start)
            emitState()
            return
        }
        if (skips.creditsCrossed(i, pos, engine.playWhenReady, hasNext())) {
            playNext()
            showMessage(I18n.s("player.res.creditsSkipped"), false)
            return
        }
        if (flow.countdown < 0 && skips.countdownDue(i, pos, dur) && flow.creditsDue(hasNext(), req.autoNext, engine.playWhenReady)) {
            handler.removeCallbacks(countdownTick)
            handler.postDelayed(countdownTick, 1000)
        }
    }

    /** CH+ / CH−: the next / previous chapter; without chapters the next / previous episode (once ffprobe answered). */
    private fun chapterKey(dir: Int) {
        showControls()
        when (val step = skips.chapterStep(index(), seeker.pending() ?: engine.positionMs, dir)) {
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
        if (!::session.isInitialized || isFinishing) return
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

    /** The QR code of the request as a crisp bitmap (one pixel per module, white quiet zone), or no card. */
    private fun setDonate(d: DonateQr?) {
        // a hide the page sent before this player was created (or before this queue was loaded)
        donateHidden = NativePlayerBridge.donateHidden(req.session)
        donateShown = DonateQr.NONE
        donateBox.visibility = View.GONE
        if (d == null) return
        val n = d.modules + 2 * DonateQr.QUIET
        val px = IntArray(n * n) { WHITE }
        for (y in 0 until d.modules) for (x in 0 until d.modules) {
            if (d.dark(x, y)) px[(y + DonateQr.QUIET) * n + x + DonateQr.QUIET] = QR_DARK
        }
        val bmp = Bitmap.createBitmap(px, n, n, Bitmap.Config.ARGB_8888)
        donateQrView.setImageDrawable(BitmapDrawable(resources, bmp).apply { isFilterBitmap = false })
        donateLink.text = d.label
    }

    /** { type: "donate", on: false } from the page. */
    fun hideDonate() {
        if (!::session.isInitialized || isFinishing) return
        donateHidden = true
        render()
    }

    /** Places the «Поддержать» card for the current state (pause: bottom right above the controls, credits: bottom left). */
    private fun renderDonate(controlsVisible: Boolean, paused: Boolean, pos: Long, dur: Long) {
        val enabled = req.donate != null && !donateHidden
        val mode = DonateQr.mode(enabled, session.error != null, paused, flow.countdown >= 0 && hasNext(), pos, dur, skips.info(index())?.creditsMs)
        if (mode == DonateQr.NONE) {
            donateBox.visibility = View.GONE
            donateShown = mode
            btnSkip.translationY = if (controlsVisible) 0f else SKIP_HIDDEN_SHIFT_DP * resources.displayMetrics.density
            return
        }
        val dp = resources.displayMetrics.density
        if (mode != donateShown) {
            donateShown = mode
            val pause = mode == DonateQr.PAUSE
            donateTitle.text = I18n.s(if (pause) "player.res.donatePauseTitle" else "player.res.donateCreditsTitle")
            donateText.text = I18n.s(if (pause) "player.res.donatePauseText" else "player.res.donateCreditsText")
            val lp = donateBox.layoutParams as FrameLayout.LayoutParams
            lp.gravity = Gravity.BOTTOM or (if (pause) Gravity.END else Gravity.START)
            lp.bottomMargin = ((if (pause) DONATE_PAUSE_BOTTOM_DP else DONATE_CREDITS_BOTTOM_DP) * dp).toInt()
            donateBox.layoutParams = lp
        }
        // in the credits the card goes above the controls while they are shown
        donateBox.translationY = if (mode == DonateQr.CREDITS && controlsVisible) -(DONATE_PAUSE_BOTTOM_DP - DONATE_CREDITS_BOTTOM_DP) * dp else 0f
        donateBox.visibility = View.VISIBLE
        // «Пропустить заставку» sits in the pause card's corner: above the card
        btnSkip.translationY = when {
            mode == DonateQr.PAUSE -> -DONATE_SKIP_LIFT_DP * dp
            controlsVisible -> 0f
            else -> SKIP_HIDDEN_SHIFT_DP * dp
        }
    }

    private fun togglePause() {
        when (flow.playPressed(engine.playWhenReady, hasNext())) {
            PlayerFlow.Play.PAUSE -> {
                // the credits countdown waits for playback (shown again on play, as on LG)
                if (flow.creditsCountdown) cancelCountdown()
                engine.pause()
            }
            PlayerFlow.Play.PLAY -> engine.play()
            // at the end of an item (the countdown dismissed with Back) Play goes on to the next one
            PlayerFlow.Play.NEXT -> {
                playNext()
                return
            }
            PlayerFlow.Play.CLOSE -> {
                close()
                return
            }
        }
        showControls()
        changed()
    }

    /** Asks TorrServer to start the next item ahead (a countdown runs or the last minute plays), once per item. */
    private fun preloadNext() {
        if (!::session.isInitialized || isFinishing) return
        if (!flow.preloadDue(index(), hasNext(), engine.playWhenReady, engine.positionMs, durationMs())) return
        session.request?.queue?.getOrNull(index() + 1)?.let { NextPreload.send(it.url) }
    }

    private fun seekBy(dir: Int) {
        val dur = durationMs()
        seeker.press(dir, engine.positionMs, dur, req.seekStep)
        handler.removeCallbacks(commitSeek)
        handler.postDelayed(commitSeek, SeekAccumulator.COMMIT_DELAY_MS)
        showControls()
    }

    private fun seekToMs(t: Long) {
        handler.removeCallbacks(commitSeek)
        seeker.cancel()
        skips.seeked()
        flow.moved()
        engine.seekTo(t)
    }

    private fun playNext() {
        cancelCountdown()
        if (hasNext()) playItem(index() + 1)
    }

    private fun playPrev() {
        cancelCountdown()
        if (index() > 0) playItem(index() - 1)
    }

    /**
     * Item change: the session keeps the left item's position as its resume point and opens [i] from its own;
     * the countdown, a seek being collected and the skips of the left item are dropped.
     */
    private fun playItem(i: Int) {
        handler.removeCallbacks(commitSeek)
        seeker.cancel()
        if (!switcher.goTo(i)) return
        cancelCountdown()
        flow.entered()
        skips.enter()
        if (undoStart != null) hideMessage()
        showControls()
        changed()
    }

    private fun retry() {
        flow.moved()
        session.retry()
        changed()
    }

    private fun onItemEnd() {
        if (isFinishing) return
        when (flow.itemEnded(hasNext(), req.autoNext)) {
            PlayerFlow.End.COUNTDOWN -> {
                handler.removeCallbacks(countdownTick)
                handler.postDelayed(countdownTick, 1000)
                preloadNext()
                render()
            }
            PlayerFlow.End.CLOSE -> close()
            PlayerFlow.End.NONE -> Unit
        }
    }

    private fun cancelCountdown() {
        flow.cancel()
        handler.removeCallbacks(countdownTick)
        if (::nextBox.isInitialized) nextBox.visibility = View.GONE
    }

    /** A seek still being collected is applied first, so that the reported position is where the user went. */
    private fun commitPendingSeek() {
        handler.removeCallbacks(commitSeek)
        seeker.take()?.let { engine.seekTo(it) }
    }

    private fun close() {
        if (isFinishing) return
        emitClosed(replaced = false)
        finish()
    }

    // ---- phone remote (control/TvRemote.kt), UI thread ----

    /**
     * A key from the phone remote handled like the TV remote's key: UP/DOWN/LEFT/RIGHT/ENTER/BACK, MENU, INFO and the
     * colour keys RED/GREEN/YELLOW/BLUE (ColorKeys.remoteCode).
     */
    fun remoteKey(name: String) {
        if (isFinishing || !::session.isInitialized) return
        val code = when (name) {
            "UP" -> KeyEvent.KEYCODE_DPAD_UP
            "DOWN" -> KeyEvent.KEYCODE_DPAD_DOWN
            "LEFT" -> KeyEvent.KEYCODE_DPAD_LEFT
            "RIGHT" -> KeyEvent.KEYCODE_DPAD_RIGHT
            "ENTER" -> KeyEvent.KEYCODE_DPAD_CENTER
            "BACK" -> KeyEvent.KEYCODE_BACK
            else -> ColorKeys.remoteCode(name) ?: return
        }
        flashBadge()
        val color = ColorKeys.actionFor(code)
        if (color != null && dialog?.isShowing == true) {
            // a colour key from the phone over a list: as on the TV remote (closes it, then its action)
            dialog?.dismiss()
            ColorKeys.inDialog(color, dialogKey)?.let { colorKey(it) }
            return
        }
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
        if (::session.isInitialized) commitPendingSeek()
        close()
    }

    /** A phone key or command arrived: the badge fades in (or stays) and hides BADGE_MS after the last one. */
    private fun flashBadge() {
        handler.removeCallbacks(hideBadge)
        badge.animate().cancel()
        if (badge.visibility != View.VISIBLE) {
            badge.alpha = 0f
            badge.visibility = View.VISIBLE
        }
        badge.animate().alpha(1f).setDuration(BADGE_FADE_MS).start()
        handler.postDelayed(hideBadge, BADGE_MS)
    }

    // ---- phone commands (src/phone/protocol.ts Cmd) ----

    fun applyCommand(cmd: JSONObject) {
        if (isFinishing || !::session.isInitialized) return
        flashBadge()
        val dur = durationMs()
        when (cmd.optString("type")) {
            "play" -> if (!engine.playWhenReady) {
                togglePause()
                return
            }
            "pause" -> if (engine.playWhenReady) engine.pause()
            "seek" -> if (dur > 0) seekToMs((cmd.optDouble("t", 0.0) * 1000).toLong().coerceIn(0L, dur))
            "skip" -> if (dur > 0) seekToMs((engine.positionMs + (cmd.optDouble("d", 0.0) * 1000).toLong()).coerceIn(0L, dur))
            "next" -> playNext()
            "prev" -> playPrev()
            "audio" -> session.selectAudio(cmd.optInt("i", -1))
            "subs" -> session.selectSub(cmd.optString("value"))
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
        if (!::session.isInitialized || isDestroyed) return
        val r = session.request ?: return
        val i = index()
        val item = r.queue.getOrNull(i) ?: return
        val dur = durationMs()
        val pos = seeker.pending() ?: engine.positionMs
        val paused = !engine.playWhenReady
        val visible = controlsShown || paused || seeker.pending() != null || session.error != null
        controls.visibility = if (visible) View.VISIBLE else View.GONE
        if (visible) {
            title.text = item.title
            progress.progress = if (dur > 0) (pos * 1000 / dur).toInt().coerceIn(0, 1000) else 0
            time.text = clock(pos) + " / " + clock(dur)
            btnPause.text = I18n.s(if (paused) "player.res.play" else "player.res.pause")
            btnAudio.text = I18n.s("player.audioRow", "v" to selectedAudioLabel(session.audioOptions()))
            btnSubs.text = I18n.s("player.subsRow", "v" to TrackOptions.selectedSub(session.subOptions()).label)
            btnNext.visibility = if (hasNext()) View.VISIBLE else View.GONE
            val chapters = skips.chapters(i)
            if (chapters.isNotEmpty()) {
                val cur = Chapters.current(chapters, pos)
                if (cur.isNotEmpty()) title.text = item.title + " · " + cur
            }
            ticksView.setTicks(Chapters.ticks(chapters, dur))
            hint.text = hintText(chapters.isNotEmpty())
            engineName.text = switcher.kind.label
        }
        toastBox.visibility = if (toastShown) View.VISIBLE else View.GONE
        toastUndo.visibility = if (undoStart != null) View.VISIBLE else View.GONE
        btnSkip.visibility = if (skipShown()) View.VISIBLE else View.GONE
        // above the controls while they are shown, near the bottom edge when they are hidden (above the donate card)
        renderDonate(visible, paused, pos, dur)
        buffering.visibility = if (engine.isBuffering && session.error == null) View.VISIBLE else View.GONE
        if (flow.countdown >= 0 && hasNext()) {
            nextBox.visibility = View.VISIBLE
            nextCount.text = I18n.s("player.nextIn", "n" to flow.countdown.toString())
            nextTitle.text = r.queue.getOrNull(i + 1)?.title.orEmpty()
        } else {
            nextBox.visibility = View.GONE
        }
        val e = session.errorText()
        errorBox.visibility = if (e != null) View.VISIBLE else View.GONE
        if (e != null) errorText.text = e
    }

    /** The key hint line and, under it, the colour keys with coloured dots (night sound only where the engine has it). */
    private fun hintText(chapters: Boolean): CharSequence {
        val base = I18n.s(if (chapters) "player.res.hintChapters" else "player.res.hint")
        val c = ColorKeys.hint(engine.nightMode != null)
        val out = SpannableString(base + "\n" + c.text)
        var from = base.length + 1
        for (color in c.dots) {
            val at = out.indexOf('\u25CF', from)
            if (at < 0) break
            out.setSpan(ForegroundColorSpan(color), at, at + 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
            from = at + 1
        }
        return out
    }

    // ---- events to the page ----

    private fun emitState() {
        if (!::session.isInitialized || closedSent) return
        val st = session.snapshot()
        if (!dedupe.shouldEmit(st, SystemClock.uptimeMillis())) return
        val aList = JSArray()
        st.audio.forEach { aList.put(it) }
        val sList = JSArray()
        st.subs.forEach { sList.put(JSObject().put("label", it.label).put("value", it.value)) }
        val o = base(st)
        o.put("paused", st.paused)
        o.put("buffering", st.buffering)
        o.put("audio", JSObject().put("list", aList).put("sel", st.audioSel))
        o.put("subs", JSObject().put("list", sList).put("sel", st.subSel))
        NativePlayerBridge.emit("nativePlayerState", o)
    }

    private fun emitClosed(replaced: Boolean) {
        if (closedSent || !::session.isInitialized) return
        closedSent = true
        commitPendingSeek()
        val o = base()
        if (replaced) o.put("replaced", true)
        NativePlayerBridge.emit("nativePlayerClosed", o)
    }

    private fun base(st: PlayerSnapshot = session.snapshot()): JSObject {
        val o = JSObject()
        runId?.let { o.put("session", it) }
        o.put("index", st.index)
        o.put("time", st.timeSec)
        o.put("duration", st.durationSec)
        return o
    }

    companion object {
        private const val TAG = "OmpPlayer"
        private const val HIDE_MS = 4000L
        /** «Инфо» refresh period. */
        private const val INFO_REFRESH_MS = 1000L
        /** «Инфо»: this share of the screen width; muted label colour (as the hint line); the accent (HDR mark). */
        private const val INFO_WIDTH = 0.40f
        private const val INFO_MUTED = 0xFF9AA1B2.toInt()
        private const val INFO_ACCENT = 0xFFF5B700.toInt()
        private const val SKIP_HIDDEN_SHIFT_DP = 150f
        /** «Поддержать»: bottom margin on pause (above the controls) and in the credits; the skip button lift. */
        private const val DONATE_PAUSE_BOTTOM_DP = 210f
        private const val DONATE_CREDITS_BOTTOM_DP = 48f
        private const val DONATE_SKIP_LIFT_DP = 190f
        private const val WHITE = 0xFFFFFFFF.toInt()
        private const val QR_DARK = 0xFF0F1115.toInt()
        /** «Заставка пропущена · Вернуть» (SKIP_TOAST_MS of src/player/chapters.ts), other messages. */
        private const val SKIP_TOAST_MS = 5000L
        private const val MESSAGE_MS = 3000L
        /** The phone badge: on screen after the last phone command, and its fade. */
        private const val BADGE_MS = 3000L
        private const val BADGE_FADE_MS = 200L
        private const val TEXT_COLOR = 0xFFE8EAF0.toInt()
        private const val ERROR_COLOR = 0xFFFF8A80.toInt()

        private val HANDLED_KEYS = setOf(
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_MEDIA_PLAY,
            KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND,
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_MEDIA_NEXT,
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_CHANNEL_DOWN,
            KeyEvent.KEYCODE_MEDIA_STOP, KeyEvent.KEYCODE_PAGE_UP, KeyEvent.KEYCODE_PAGE_DOWN,
            KeyEvent.KEYCODE_INFO, KeyEvent.KEYCODE_PROG_RED, KeyEvent.KEYCODE_PROG_GREEN, KeyEvent.KEYCODE_PROG_YELLOW,
            KeyEvent.KEYCODE_PROG_BLUE,
        )

        fun clock(ms: Long): String = formatClock(ms)
    }
}
