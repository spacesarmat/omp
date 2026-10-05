package com.spacesarmat.omp.player

/** The two engines behind the player UI. [wire] is the value the page stores, [label] the name on screen. */
enum class EngineKind(val wire: String, val label: String) {
    MEDIA3("builtin", "Встроенный"),
    VLC("vlc", "VLC"),
    ;

    val other: EngineKind get() = if (this == MEDIA3) VLC else MEDIA3
}

/** «Плеер» of the TV settings (or the torrent's own choice): «Авто», «Встроенный», «VLC». */
enum class EngineMode {
    AUTO,
    BUILTIN,
    VLC,
    ;

    companion object {
        /** The playNative `engine` value; anything else is «Авто». */
        fun parse(s: String?): EngineMode = when (s) {
            "builtin" -> BUILTIN
            "vlc" -> VLC
            else -> AUTO
        }
    }
}

/** Why the engine changed: Media3 could not open the file, ASS/SSA subtitles, the player menu. */
enum class SwitchReason(val wire: String) {
    FORMAT("format"),
    ASS("ass"),
    MANUAL("manual"),
}

/**
 * Which engine plays, for one playNative run. «Встроенный» / «VLC» stay put. «Авто» starts on Media3 and moves to
 * VLC, at most once and never back: when Media3 fails before the first frame because of the format or a decoder
 * ([onError]), or when the page's ffprobe says the subtitles to show are ASS/SSA ([initial], [onAssSubs]).
 * A choice from the player menu ([toggle]) ends the automatic decisions for the run. Without libVLC on this device
 * ([vlcAvailable] false) everything stays on Media3.
 */
class EngineChooser(val mode: EngineMode, val vlcAvailable: Boolean = true) {
    var current: EngineKind = EngineKind.MEDIA3
        private set

    private var manual = false

    private val auto: Boolean get() = mode == EngineMode.AUTO && !manual && vlcAvailable

    /** The engine to open the run's first item with ([assSubs]: that item's subtitles are ASS/SSA). */
    fun initial(assSubs: Boolean): EngineKind {
        current = when {
            !vlcAvailable -> EngineKind.MEDIA3
            else -> when (mode) {
            EngineMode.BUILTIN -> EngineKind.MEDIA3
            EngineMode.VLC -> EngineKind.VLC
            EngineMode.AUTO -> if (assSubs) EngineKind.VLC else EngineKind.MEDIA3
            }
        }
        return current
    }

    /**
     * True: switch to VLC now ([SwitchReason.FORMAT]); [firstFrame]: the current item already showed a frame.
     * [detail] is the engine's error code name: Media3's DECODING_FAILED counts too (its kind stays OTHER for the
     * on-screen text).
     */
    fun onError(kind: ErrorKind, firstFrame: Boolean, detail: String = ""): Boolean {
        if (!auto || current != EngineKind.MEDIA3 || firstFrame) return false
        if (kind != ErrorKind.UNSUPPORTED_FORMAT && kind != ErrorKind.DECODER && detail != DECODING_FAILED) return false
        current = EngineKind.VLC
        return true
    }

    /** The current item's subtitles turned out to be ASS/SSA; true: switch to VLC now ([SwitchReason.ASS]). */
    fun onAssSubs(): Boolean {
        if (!auto || current != EngineKind.MEDIA3) return false
        current = EngineKind.VLC
        return true
    }

    /** «Плеер: … → сменить»: the other engine, kept for the rest of the run (no change without libVLC). */
    fun toggle(): EngineKind {
        if (!vlcAvailable) return current
        manual = true
        current = current.other
        return current
    }

    /** The engine could not be created: the run goes on with [kind], without automatic switches. */
    fun fallBack(kind: EngineKind) {
        current = kind
        manual = true
    }

    companion object {
        /** «Плеер: VLC → сменить на встроенный» (the player menu row). */
        fun menuRow(current: EngineKind, vlcAvailable: Boolean = true): String =
            if (!vlcAvailable) "Плеер: " + current.label + " · " + VLC_UNAVAILABLE_TEXT
            else "Плеер: " + current.label + " → сменить на " + (if (current.other == EngineKind.VLC) "VLC" else "встроенный")

        /** Media3's PlaybackException code name of a decoder that failed while decoding. */
        const val DECODING_FAILED = "ERROR_CODE_DECODING_FAILED"

        /** libVLC has no native libraries for this device (menu row, message, TV settings). */
        const val VLC_UNAVAILABLE_TEXT = "VLC недоступен на этом устройстве"

        /** The message after the automatic switch because of the format. */
        const val FORMAT_SWITCH_TEXT = "Встроенный плеер не открыл этот файл — включён VLC"
    }
}
