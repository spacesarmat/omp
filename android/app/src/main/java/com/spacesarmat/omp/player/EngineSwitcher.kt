package com.spacesarmat.omp.player

/**
 * The engine decisions of the player activity, testable without Android: which engine a run starts on, the
 * «Авто» switches (Media3 error before the first frame, ASS subtitles of the current or the next item), the menu
 * row and its press, and what happens when libVLC cannot be used. The activity ([Host]) only creates engines,
 * posts, shows and reports.
 */
class EngineSwitcher(private val host: Host, val vlcAvailable: Boolean) {
    interface Host {
        /** True while the activity is finishing: nothing switches any more. */
        val finishing: Boolean

        /** A new engine of [kind], attached to the video container; null when it cannot be created. */
        fun create(kind: EngineKind): PlayerEngine?

        /** Runs [block] later on the main thread (not inside the failing engine's callback). */
        fun post(block: () -> Unit)

        /** The page's ffprobe found ASS/SSA subtitles in item [index] of [r]. */
        fun assSubs(r: PlayRequest, index: Int): Boolean

        /** Right before a switch (a seek being collected is applied, so the position is where the user went). */
        fun beforeSwitch()

        /** The engine changed (toast for [SwitchReason.FORMAT], event to the page, redraw). */
        fun switched(kind: EngineKind, reason: SwitchReason)

        /** A short message on the player («VLC недоступен на этом устройстве»). */
        fun message(text: String)
    }

    var chooser = EngineChooser(EngineMode.AUTO, vlcAvailable)
        private set

    /** The kind of the engine playing now. */
    var kind = EngineKind.MEDIA3
        private set

    lateinit var session: PlayerSession

    private fun begin(r: PlayRequest): EngineKind {
        chooser = EngineChooser(r.engine, vlcAvailable)
        return chooser.initial(host.assSubs(r, r.index))
    }

    /** A kind that could not be created: Media3 for the rest of the run. */
    private fun createOrFallBack(k: EngineKind): PlayerEngine? {
        val e = host.create(k)
        if (e == null) chooser.fallBack(kind)
        return e
    }

    /** The engine of the activity's first run (Media3 if libVLC fails to start). */
    fun firstEngine(r: PlayRequest): PlayerEngine {
        val k = begin(r)
        val e = host.create(k)
        if (e != null) {
            kind = k
            return e
        }
        chooser.fallBack(EngineKind.MEDIA3)
        kind = EngineKind.MEDIA3
        return host.create(EngineKind.MEDIA3) ?: error("Media3 engine")
    }

    /** A new run (playNative over an open player): its engine when it differs from the playing one, else null. */
    fun engineForRun(r: PlayRequest): PlayerEngine? {
        val k = begin(r)
        if (k == kind) return null
        val e = createOrFallBack(k) ?: return null
        kind = k
        return e
    }

    /** [PlayerSession.Ui.engineFailed]: «Авто» moves the item to VLC; true when the error is taken over. */
    fun engineFailed(error: ErrorKind, detail: String, beforeFirstFrame: Boolean): Boolean {
        if (host.finishing || !chooser.onError(error, !beforeFirstFrame, detail)) return false
        host.post {
            // libVLC could not start (the chooser stopped switching): the error after all
            if (!switchTo(EngineKind.VLC, SwitchReason.FORMAT) && !host.finishing) session.onError(error, "vlc_unavailable")
        }
        return true
    }

    /** The page says item [index] has ASS/SSA subtitles: the current item moves to VLC («Авто»). */
    fun assSubsKnown(index: Int) {
        if (host.finishing || index != session.index) return
        if (chooser.onAssSubs()) switchTo(EngineKind.VLC, SwitchReason.ASS)
    }

    /** Item change; an ASS-flagged item opens on VLC directly («Авто»). False: no such item. */
    fun goTo(i: Int): Boolean {
        val r = session.request ?: return false
        if (i !in r.queue.indices || i == session.index) return false
        var next: PlayerEngine? = null
        if (kind == EngineKind.MEDIA3 && host.assSubs(r, i) && chooser.onAssSubs()) {
            next = createOrFallBack(EngineKind.VLC)
            if (next != null) kind = EngineKind.VLC
        }
        session.goTo(i, next)
        if (next != null) host.switched(kind, SwitchReason.ASS)
        return true
    }

    /** «Плеер: Встроенный → сменить на VLC» / «Плеер: VLC → сменить на встроенный» / «… · VLC недоступен …». */
    fun menuRow(): String = EngineChooser.menuRow(kind, vlcAvailable)

    fun menuPressed() {
        if (!vlcAvailable) {
            host.message(EngineChooser.VLC_UNAVAILABLE_TEXT)
            return
        }
        switchTo(chooser.toggle(), SwitchReason.MANUAL)
    }

    /** The current item continues on [k] at the same position; false when nothing changed. */
    fun switchTo(k: EngineKind, reason: SwitchReason): Boolean {
        if (host.finishing || k == kind) return false
        host.beforeSwitch()
        val next = createOrFallBack(k) ?: return false
        kind = k
        session.switchEngine(next)
        host.switched(k, reason)
        return true
    }
}
