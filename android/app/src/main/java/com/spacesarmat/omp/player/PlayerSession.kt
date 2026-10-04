package com.spacesarmat.omp.player

import java.util.Locale

/** An audio choice of the menu and of `nativePlayerState` (`audio.list` labels, `audio.sel` index). */
data class AudioOption(val track: EngineTrack, val label: String)

/** A subtitle choice: `value` «off», «e<n>» (embedded) or «x<n>» (the item's file n), as subtitleMenu on LG. */
data class SubOption(val value: String, val label: String, val track: EngineTrack?)

/** What the page gets in `nativePlayerState` / `nativePlayerClosed` (times in seconds). */
data class PlayerSnapshot(
    val index: Int,
    val timeSec: Double,
    val durationSec: Double,
    val paused: Boolean,
    val buffering: Boolean,
    val audio: List<String>,
    val audioSel: Int,
    val subs: List<SubOption>,
    val subSel: String,
)

/** Engine-independent track labels and menu lists. */
object TrackOptions {
    private val RU = Locale.forLanguageTag("ru")

    /** «Русский» for «ru» / «rus»; empty for «und», unknown or unnamed codes. */
    fun language(code: String?): String {
        if (code.isNullOrEmpty() || code == "und") return ""
        val name = Locale.forLanguageTag(code).getDisplayLanguage(RU)
        if (name.isEmpty() || name.equals(code, ignoreCase = true)) return ""
        return name.replaceFirstChar { it.titlecase(RU) }
    }

    fun channels(n: Int): String = when {
        n <= 0 -> ""
        n == 1 -> "1.0"
        n == 2 -> "2.0"
        n == 6 -> "5.1"
        n == 8 -> "7.1"
        else -> "$n кан."
    }

    /** «Русский · Дубляж · AC3 5.1» (empty parts left out), «Дорожка n» when nothing is known. */
    fun audioLabel(t: EngineTrack, n: Int): String {
        val tech = listOf(t.codec, channels(t.channels)).filter { it.isNotEmpty() }.joinToString(" ")
        val parts = ArrayList<String>()
        for (p in listOf(language(t.language), t.label.orEmpty(), tech)) if (p.isNotEmpty() && p !in parts) parts.add(p)
        return if (parts.isEmpty()) "Дорожка $n" else parts.joinToString(" · ")
    }

    fun subLabel(t: EngineTrack, n: Int): String {
        val parts = ArrayList<String>()
        for (p in listOf(language(t.language), t.label.orEmpty())) if (p.isNotEmpty() && p !in parts) parts.add(p)
        return if (parts.isEmpty()) "Субтитры $n" else parts.joinToString(" · ")
    }

    fun audio(tracks: List<EngineTrack>): List<AudioOption> = tracks.mapIndexed { i, t -> AudioOption(t, audioLabel(t, i + 1)) }

    /** «Выкл», embedded tracks (e<n>), then the item's files (x<n>, named after [files]) in file order. */
    fun subs(tracks: List<EngineTrack>, files: List<SubFile>): List<SubOption> {
        val out = arrayListOf(SubOption("off", "Выкл", null))
        val external = ArrayList<Pair<Int, SubOption>>()
        var embedded = 0
        for (t in tracks) {
            val x = t.external
            if (x != null) {
                val label = files.getOrNull(x)?.label ?: (t.label ?: "Файл")
                external.add(x to SubOption("x$x", "$label (файл)", t))
            } else {
                out.add(SubOption("e$embedded", subLabel(t, embedded + 1), t))
                embedded++
            }
        }
        external.sortBy { it.first }
        external.forEach { out.add(it.second) }
        return out
    }

    fun selectedAudio(list: List<AudioOption>): Int = list.indexOfFirst { it.track.selected }

    fun selectedSub(list: List<SubOption>): SubOption = list.firstOrNull { it.track?.selected == true } ?: list[0]
}

/**
 * The queue on top of a [PlayerEngine]: the current item, resume points of the items (the item left keeps its
 * position, cleared when nearly finished as resumePosition does; a new item starts from its own), the error on
 * screen, track menus and what is reported to the page. No Android UI: the activity draws from it.
 */
class PlayerSession(engine: PlayerEngine, private val ui: Ui) : PlayerEngine.Listener {
    /** The activity's reactions to engine events. */
    interface Ui {
        /** Redraw the overlay and report the state to the page. */
        fun changed()

        /** The current item played to its end. */
        fun itemEnded()

        /**
         * The engine failed ([beforeFirstFrame]: the current item has not shown a frame yet). True: the activity
         * takes over (it moves the item to another engine with [switchEngine]) and no error is shown.
         */
        fun engineFailed(kind: ErrorKind, detail: String, beforeFirstFrame: Boolean): Boolean = false
    }

    /** The engine playing now ([switchEngine] replaces it). */
    var engine: PlayerEngine = engine
        private set

    /** Track choices carried over from the previous engine, applied once the new one lists its tracks. */
    private var pendingAudio: EngineTrack? = null
    private var pendingSub: EngineTrack? = null

    var request: PlayRequest? = null
        private set

    /** Current queue item. */
    var index = 0
        private set

    private var resume = LongArray(0)

    /** Last position / duration seen on a tick (the resume point of the item when it is left). */
    var lastPosMs = 0L
        private set
    var lastDurMs = 0L
        private set

    var error: ErrorKind? = null
        private set

    /** The first video frame of the current item was shown (since [load] / [goTo]). */
    var firstFrame = false
        private set

    init {
        this.engine.listener = this
    }

    val queueSize: Int get() = request?.queue?.size ?: 0

    fun hasNext(): Boolean = index < queueSize - 1

    fun item(): QueueItem? = request?.queue?.getOrNull(index)

    /**
     * A new queue: preferences reset, item [PlayRequest.index] opens at [PlayRequest.startAtMs]. With [next]
     * (already attached by the caller) the queue plays on that engine and the current one is released.
     */
    fun load(r: PlayRequest, next: PlayerEngine? = null) {
        if (next != null && next !== engine) {
            engine.listener = null
            engine.release()
            engine = next
            next.listener = this
        }
        request = r
        resume = LongArray(r.queue.size) { r.queue[it].resumeMs }
        index = r.index
        lastPosMs = r.startAtMs
        lastDurMs = 0L
        error = null
        firstFrame = false
        pendingAudio = null
        pendingSub = null
        engine.setPreferences(TrackPrefs(r.audioLang, r.subLang, r.subtitlesOn))
        engine.open(media(r.queue[index]), r.startAtMs)
    }

    /** Leaves the current item (its resume point is kept) and plays item [i] from its own; false: no such item. */
    fun goTo(i: Int, next: PlayerEngine? = null): Boolean {
        val r = request ?: return false
        if (i !in r.queue.indices || i == index) return false
        tick()
        // another engine for this item (already attached by the caller): the choices go over by language
        val carried = if (next != null && next !== engine) adopt(next, r) else null
        val watched = lastDurMs > 0 && lastPosMs.toDouble() / lastDurMs >= WATCHED_RATIO
        if (index in resume.indices) resume[index] = if (watched || lastPosMs < MIN_RESUME_MS) 0L else lastPosMs
        index = i
        val start = resume[i]
        lastPosMs = start
        lastDurMs = 0L
        error = null
        firstFrame = false
        pendingAudio = carried?.first
        // a file of the previous item means nothing here: its language is in the preferences
        pendingSub = carried?.second?.takeIf { it.external == null }
        engine.open(media(r.queue[i]), start)
        return true
    }

    /**
     * Releases the current engine and puts [next] in its place with the selected tracks as preferences; returns
     * the selected audio / subtitle tracks of the released engine.
     */
    private fun adopt(next: PlayerEngine, r: PlayRequest): Pair<EngineTrack?, EngineTrack?> {
        val old = engine
        val audio = old.audioTracks().firstOrNull { it.selected }
        val sub = old.subtitleTracks().firstOrNull { it.selected }
        old.listener = null
        old.release()
        engine = next
        next.listener = this
        next.setPreferences(
            TrackPrefs(
                audioLang = audio?.language ?: r.audioLang,
                subLang = sub?.language?.ifEmpty { null }
                    ?: sub?.external?.let { x -> r.queue.getOrNull(index)?.subtitles?.getOrNull(x)?.lang?.ifEmpty { null } }
                    ?: r.subLang,
                subtitlesOn = sub != null,
            ),
        )
        return audio to sub
    }

    /**
     * Continues the current item on [next] (already attached by the caller): same queue item and position,
     * paused if it was paused, the selected audio / subtitle tracks re-picked by language (and title / file) once
     * [next] lists its tracks. The previous engine is released (its view removed). Resume points are kept.
     */
    fun switchEngine(next: PlayerEngine) {
        val old = engine
        val r = request
        tick()
        val pos = old.positionMs
        val playing = old.playWhenReady
        error = null
        firstFrame = false
        if (r == null) {
            old.listener = null
            old.release()
            engine = next
            next.listener = this
            return
        }
        val (audio, sub) = adopt(next, r)
        pendingAudio = audio
        pendingSub = sub
        next.open(media(r.queue[index]), pos)
        if (!playing) next.pause()
    }

    /** The carried-over choices on the new engine's tracks (by subtitle file, else language + title). */
    private fun applyPending() {
        val a = pendingAudio
        if (a != null) {
            val list = engine.audioTracks()
            if (list.isNotEmpty()) {
                pendingAudio = null
                val m = list.firstOrNull { it.language == a.language && it.label == a.label }
                if (m != null && !m.selected) engine.selectAudio(m.id)
            }
        }
        val s = pendingSub
        if (s != null) {
            val list = engine.subtitleTracks()
            if (list.isNotEmpty()) {
                pendingSub = null
                val m = if (s.external != null) list.firstOrNull { it.external == s.external }
                else list.firstOrNull { it.external == null && it.language == s.language && it.label == s.label }
                if (m != null && !m.selected) engine.selectSubtitle(m.id)
            }
        }
    }

    /** Resume point of item [i] (as it would be used when going there). */
    fun resumeOf(i: Int): Long = resume.getOrElse(i) { 0L }

    /** Position tick: remembers where the current item is. */
    fun tick() {
        lastPosMs = engine.positionMs
        engine.durationMs.let { if (it > 0) lastDurMs = it }
    }

    fun retry() {
        error = null
        engine.retry()
    }

    fun errorText(): String? = error?.let { message(it) }

    fun audioOptions(): List<AudioOption> = TrackOptions.audio(engine.audioTracks())

    fun subOptions(): List<SubOption> = TrackOptions.subs(engine.subtitleTracks(), item()?.subtitles ?: emptyList())

    /** «audio» of the phone / the menu: option [i] of [audioOptions]. */
    fun selectAudio(i: Int) {
        val o = audioOptions().getOrNull(i) ?: return
        engine.selectAudio(o.track.id)
    }

    /** «subs» of the phone / the menu: a [SubOption.value]. */
    fun selectSub(value: String) {
        if (value == "off") {
            engine.selectSubtitle(null)
            return
        }
        val t = subOptions().firstOrNull { it.value == value }?.track ?: return
        engine.selectSubtitle(t.id)
    }

    fun snapshot(): PlayerSnapshot {
        val audio = audioOptions()
        val subs = subOptions()
        return PlayerSnapshot(
            index = index,
            timeSec = engine.positionMs.coerceAtLeast(0L) / 1000.0,
            durationSec = engine.durationMs.coerceAtLeast(0L) / 1000.0,
            paused = !engine.playWhenReady || error != null,
            buffering = engine.isBuffering,
            audio = audio.map { it.label },
            audioSel = TrackOptions.selectedAudio(audio),
            subs = subs,
            subSel = TrackOptions.selectedSub(subs).value,
        )
    }

    private fun media(q: QueueItem) = EngineMedia(q.url, q.subtitles)

    // ---- engine events ----

    override fun onReady() {
        error = null
        ui.changed()
    }

    override fun onFirstFrame() {
        firstFrame = true
    }

    override fun onBuffering(buffering: Boolean) = ui.changed()

    override fun onPlayingChanged(playing: Boolean) = ui.changed()

    override fun onTracksChanged() {
        applyPending()
        ui.changed()
    }

    override fun onEnded() {
        ui.itemEnded()
        ui.changed()
    }

    override fun onError(kind: ErrorKind, detail: String) {
        if (ui.engineFailed(kind, detail, !firstFrame)) return
        error = kind
        ui.changed()
    }

    companion object {
        const val WATCHED_RATIO = 0.9
        const val MIN_RESUME_MS = 10_000L

        /** The text of the error box. */
        fun message(kind: ErrorKind): String = when (kind) {
            ErrorKind.NETWORK -> "Сервер недоступен или не отвечает"
            ErrorKind.UNSUPPORTED_FORMAT, ErrorKind.DECODER -> "Формат видео не поддерживается"
            ErrorKind.OTHER -> "Не удалось воспроизвести видео"
        }
    }
}
