package com.spacesarmat.omp.player

import android.view.ViewGroup

/**
 * A playback engine behind the OMP player UI (Media3 today, libVLC next). The engine plays one queue item at a
 * time: the queue, resume points, chapters, skips, the countdown and the overlay live above it ([PlayerSession],
 * [PlayerActivity]) and do not know which engine runs. All calls and callbacks happen on the main thread.
 */
interface PlayerEngine {
    /** Engine events; set before [open]. */
    var listener: Listener?

    /** Puts the engine's video surface (with its subtitle layer) into [container] (match_parent, behind the overlay). */
    fun attach(container: ViewGroup)

    /**
     * Preferred languages and whether subtitles are on, applied to the items opened afterwards and clearing the
     * user's manual choices (a new playNative). Choices made with [selectAudio] / [selectSubtitle] otherwise carry
     * over to the next item where they apply (subtitles off stay off).
     */
    fun setPreferences(prefs: TrackPrefs)

    /** Opens [media] at [startMs] (0: the start) and starts playing; the previous item is dropped. */
    fun open(media: EngineMedia, startMs: Long)

    fun play()

    fun pause()

    fun seekTo(ms: Long)

    /** After [Listener.onError]: tries the same item again from the current position and plays. */
    fun retry()

    /** Current position, ms (≥ 0). */
    val positionMs: Long

    /** Duration of the open item, ms; 0 while unknown. */
    val durationMs: Long

    /** Playback is wanted (not paused by the user or at the end); true while buffering. */
    val playWhenReady: Boolean

    /** Waiting for data. */
    val isBuffering: Boolean

    /** Audio tracks the engine can play, in file order. */
    fun audioTracks(): List<EngineTrack>

    /** Subtitle tracks the engine can show: embedded ones in file order, then the item's files ([EngineTrack.external]). */
    fun subtitleTracks(): List<EngineTrack>

    /** [id] of one of [audioTracks]. */
    fun selectAudio(id: String)

    /** [id] of one of [subtitleTracks]; null turns subtitles off. */
    fun selectSubtitle(id: String?)

    /** The activity was stopped (its video surface goes away); libVLC detaches its views. */
    fun hostStopped() {}

    /** The activity was started again after [hostStopped]. */
    fun hostStarted() {}

    /** Frees the decoders and removes what [attach] added; the engine is not used afterwards. */
    fun release()

    interface Listener {
        /** The open item can play (also after buffering or [retry]). */
        fun onReady() {}

        /** The first video frame of the open item is on screen (media without video: when it is first ready). Once per [open]. */
        fun onFirstFrame() {}

        /** Sent when the flag changes. */
        fun onBuffering(buffering: Boolean) {}

        /** [playWhenReady] changed. */
        fun onPlayingChanged(playing: Boolean) {}

        /** Track lists or the selection changed. */
        fun onTracksChanged() {}

        /** The open item played to its end (the engine pauses there). */
        fun onEnded() {}

        /** Playback stopped with an error; [detail] is technical (an error code name), never shown or logged with a URL. */
        fun onError(kind: ErrorKind, detail: String) {}
    }
}

/** What went wrong, engine-independent (the message on screen, and «Авто» switching engines in v0.15). */
enum class ErrorKind {
    /** Container or codec the engine cannot handle at all. */
    UNSUPPORTED_FORMAT,

    /** A decoder or audio output failed to start for a format that is otherwise known. */
    DECODER,

    /** The server is unreachable, does not answer or answers with an error status. */
    NETWORK,
    OTHER,
}

/** One queue item for an engine: the stream (credentials may be in the URL: user:password@) and its subtitle files. */
data class EngineMedia(val url: String, val subtitles: List<SubFile>)

/** Preferred audio / subtitle languages (empty: no preference) and whether subtitles start on. */
data class TrackPrefs(val audioLang: String, val subLang: String, val subtitlesOn: Boolean)

/**
 * An audio or subtitle track as the engine reports it. [id] is engine-specific and valid while the item is open;
 * [language] is the file's code («ru», «rus», «und» or null), [label] the file's own track title, [codec] a short
 * display name («AC3», «DTS», empty when unknown), [channels] 0 when unknown. [external] is the index in the
 * queue item's [EngineMedia.subtitles] for a subtitle file, null for an embedded track.
 */
data class EngineTrack(
    val id: String,
    val language: String?,
    val label: String?,
    val codec: String = "",
    val channels: Int = 0,
    val selected: Boolean = false,
    val external: Int? = null,
)
