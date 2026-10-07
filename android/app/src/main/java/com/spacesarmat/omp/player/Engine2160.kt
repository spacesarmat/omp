package com.spacesarmat.omp.player

import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import tv.p2160.core.api.ExternalSubtitle
import tv.p2160.core.api.MediaEntry
import tv.p2160.core.api.PlaybackRequest
import tv.p2160.core.api.PlayerConfig
import tv.p2160.core.engine.PlayerController
import tv.p2160.core.settings.PlayerSettings
import java.util.Base64
import java.util.Locale

/**
 * [PlayerEngine] on 2160 Player's engine ([PlayerController] of player-core): its ExoPlayer with the FFmpeg audio
 * and video fallbacks of nextlib, AC3/E-AC3/DTS/TrueHD passthrough guarded against TVs that cannot open it,
 * «Ночной звук», Dolby Vision fallback to the HDR10 base layer, M2TS and Blu-ray ISO routing, cp1251 subtitle
 * files re-encoded to UTF-8. One controller per opened item (its API plays one request); OMP's own UI, queue,
 * skips and resume points stay above it, so 2160's own features that would compete with them are kept quiet
 * through its [PlayerConfig] ([config]): no history (nothing restored or saved), no sound-based intro search,
 * no chapter reading (OMP has its own), the buffer capped by the app's heap, OMP's HTTP timeouts. The video goes to a Media3 [PlayerView]
 * bound to the controller's player (its subtitle layer draws the cues, as before).
 */
@OptIn(UnstableApi::class)
class Engine2160(private val context: Context) : PlayerEngine {
    override var listener: PlayerEngine.Listener? = null

    private val app = context.applicationContext
    private val settings = PlayerSettings.get(app)
    private val main = Handler(Looper.getMainLooper())

    private var controller: PlayerController? = null
    private var view: PlayerView? = null

    /** The open item's media items are in the player (the controller sets them after a short async build). */
    private var loaded = false

    /** Position asked for before [loaded] (the start or a seek), and the playWhenReady wanted then. */
    private var pendingSeek: Long? = null
    private var wantPlay = true

    /** The start position of the open item. */
    private var openStart = 0L

    private var prefs = TrackPrefs("", "", true)

    /** Subtitles off, carried to the next items (set by [setPreferences], changed by [selectSubtitle]). */
    private var textOff = false

    private var endSent = false
    private var frameSent = false
    private var buffering = false

    /** Hash of each external subtitle's Uri → its index in [EngineMedia.subtitles] (the controller's format ids carry the hash). */
    private var externalHashes: Map<Int, Int> = emptyMap()

    private val player: ExoPlayer? get() = controller?.player

    private val events = object : Player.Listener {
        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            val p = player ?: return
            if (loaded || p.mediaItemCount == 0) return
            loaded = true
            // the controller seeks to the start and sets playWhenReady right after setting the items: apply ours after it
            main.post { applyPending() }
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) ended()
            listener?.onPlayingChanged(playWhenReady)
        }

        override fun onPlaybackStateChanged(state: Int) {
            val p = player ?: return
            if (state == Player.STATE_ENDED) ended()
            if (state == Player.STATE_READY) {
                // audio-only media never renders a frame: being ready counts as the first frame
                if (!p.currentTracks.containsType(C.TRACK_TYPE_VIDEO)) firstFrame()
                listener?.onReady()
            }
            val b = state == Player.STATE_BUFFERING
            if (b != buffering) {
                buffering = b
                listener?.onBuffering(b)
            }
        }

        override fun onRenderedFirstFrame() = firstFrame()

        override fun onTracksChanged(tracks: Tracks) {
            listener?.onTracksChanged()
        }

        override fun onPlayerError(e: PlaybackException) {
            // the controller's own listener runs first and recovers some errors at once (a TV that cannot open
            // AC3/DTS passthrough: decode instead; behind the live window): it prepared again, nothing to report
            if (player?.playerError == null) {
                Log.i(TAG, "recovered by the engine: ${e.errorCodeName}")
                return
            }
            // out of memory (wrapped in a source error): «Авто» may still move the item to VLC
            listener?.onError(errorKind(e.errorCode), if (PlayerBuffer.causedByOom(e)) EngineChooser.OUT_OF_MEMORY else e.errorCodeName)
        }
    }

    private fun applyPending() {
        val p = player ?: return
        pendingSeek?.let { p.seekTo(it) }
        pendingSeek = null
        if (!wantPlay) p.pause()
    }

    private fun firstFrame() {
        if (frameSent) return
        frameSent = true
        listener?.onFirstFrame()
    }

    private fun ended() {
        if (endSent) return
        endSent = true
        listener?.onEnded()
    }

    override fun attach(container: ViewGroup) {
        val v = PlayerView(context).apply {
            useController = false
            setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
            isFocusable = false
            player = this@Engine2160.player
        }
        container.addView(v, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        view = v
    }

    override fun setPreferences(prefs: TrackPrefs) {
        this.prefs = prefs
        textOff = !prefs.subtitlesOn
        player?.let { applyTrackPrefs(it) }
    }

    /** The preferences over the controller's selector parameters (2160's own language list and smart choice replaced). */
    private fun applyTrackPrefs(p: ExoPlayer) {
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .clearOverrides()
            .setPreferredAudioLanguage(prefs.audioLang.ifEmpty { null })
            .setPreferredTextLanguage(prefs.subLang.ifEmpty { null })
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, textOff)
            .build()
    }

    override fun open(media: EngineMedia, startMs: Long) {
        closeController()
        endSent = false
        frameSent = false
        loaded = false
        wantPlay = true
        val start = startMs.coerceAtLeast(0L)
        openStart = start
        pendingSeek = null
        val (url, auth) = splitCredentials(media.url)
        val headers = auth + ("User-Agent" to USER_AGENT)
        val uri = Uri.parse(url)
        val subs = ArrayList<ExternalSubtitle>()
        val hashes = HashMap<Int, Int>()
        media.subtitles.forEachIndexed { n, s ->
            if (subMime(s.ext) == null || s.url.isEmpty()) return@forEachIndexed
            val su = Uri.parse(splitCredentials(s.url).first)
            subs.add(ExternalSubtitle(su, subtitleName(s.label, s.ext, n), s.lang.ifEmpty { null }))
            hashes[su.hashCode()] = n
        }
        externalHashes = hashes
        val request = PlaybackRequest(
            items = listOf(MediaEntry(uri, title = null, subtitles = subs)),
            startPositionMs = start,
            headers = headers,
        )
        val c = PlayerController(app, request, config(PlayerBuffer.memoryClassMb(app)))
        controller = c
        val p = c.player
        p.addListener(events)
        // the end of an item pauses (the UI decides: countdown or close)
        p.pauseAtEndOfMediaItems = true
        applyTrackPrefs(p)
        // wanted at once (the controller sets it after building the item); the UI reads it right after open
        p.playWhenReady = true
        view?.player = p
    }

    override fun play() {
        endSent = false
        wantPlay = true
        player?.play()
    }

    override fun pause() {
        wantPlay = false
        player?.pause()
    }

    override fun seekTo(ms: Long) {
        endSent = false
        if (!loaded) pendingSeek = ms else player?.seekTo(ms)
    }

    override fun retry() {
        endSent = false
        wantPlay = true
        controller?.retry()
    }

    override val positionMs: Long
        get() {
            val p = player ?: return 0L
            // before the items are in the player its position is 0: the requested one instead
            if (!loaded) return pendingSeek ?: openStart
            return p.currentPosition.coerceAtLeast(0L)
        }

    override val durationMs: Long get() = player?.duration?.let { if (it == C.TIME_UNSET || it < 0) 0L else it } ?: 0L

    override val playWhenReady: Boolean get() = player?.playWhenReady ?: false

    override val isBuffering: Boolean get() = player?.playbackState == Player.STATE_BUFFERING

    override fun audioTracks(): List<EngineTrack> = tracksOf(C.TRACK_TYPE_AUDIO)

    override fun subtitleTracks(): List<EngineTrack> = tracksOf(C.TRACK_TYPE_TEXT)

    /** Supported groups of [type]; the id is the group's place in currentTracks («g<n>»). */
    private fun tracksOf(type: Int): List<EngineTrack> {
        val p = player ?: return emptyList()
        val out = ArrayList<EngineTrack>()
        p.currentTracks.groups.forEachIndexed { n, g ->
            if (g.type == type && g.isSupported) {
                val f = g.getTrackFormat(0)
                out.add(trackOf("g$n", externalIndex(f.id, externalHashes), f.language, f.label, f.sampleMimeType, f.channelCount, g.isSelected))
            }
        }
        return out
    }

    private fun group(id: String, type: Int): Tracks.Group? {
        val n = id.removePrefix("g").toIntOrNull() ?: return null
        return player?.currentTracks?.groups?.getOrNull(n)?.takeIf { it.type == type }
    }

    override fun selectAudio(id: String) {
        val p = player ?: return
        val g = group(id, C.TRACK_TYPE_AUDIO) ?: return
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0))
            .build()
    }

    override fun selectSubtitle(id: String?) {
        val p = player
        if (id == null) {
            textOff = true
            p ?: return
            p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
            return
        }
        p ?: return
        val g = group(id, C.TRACK_TYPE_TEXT) ?: return
        textOff = false
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0))
            .build()
    }

    override val nightMode: Boolean? get() = controller?.state?.value?.nightMode ?: settings.current.nightMode

    /**
     * «Ночной звук» now (decoding instead of passthrough for the rest of this item) and for the next items and runs
     * (2160's setting, applied when a controller starts: then multichannel is also downmixed to stereo).
     */
    override fun setNightMode(on: Boolean) {
        settings.update { it.copy(nightMode = on) }
        controller?.setNightMode(on)
    }

    private fun closeController() {
        val c = controller ?: return
        controller = null
        view?.player = null
        c.player.removeListener(events)
        main.removeCallbacksAndMessages(null)
        c.release()
    }

    override fun release() {
        listener = null
        closeController()
        view?.let { v ->
            v.player = null
            (v.parent as? ViewGroup)?.removeView(v)
        }
        view = null
    }

    companion object {
        private const val TAG = "OmpPlayer"
        private const val USER_AGENT = "OMP"

        /**
         * 2160's engine settings for OMP: the buffer capped by the heap ([PlayerBuffer], 16-64 MB), OMP's earlier
         * HTTP timeouts, and 2160's own history, intro search and chapter reading off (OMP keeps its resume points,
         * skips and chapters; explicit start positions and subtitle selections work regardless).
         */
        fun config(memoryClassMb: Int) = PlayerConfig(
            bufferTargetBytes = PlayerBuffer.capBytes(memoryClassMb),
            connectTimeoutMs = 30_000,
            readTimeoutMs = 60_000,
            introDetection = false,
            readChapters = false,
            restoreFromHistory = false,
            saveHistory = false,
        )

        /** The controller's id of an external subtitle ends with «:<hash of its Uri>» («ext:0:-12345»). */
        fun externalIndex(formatId: String?, hashes: Map<Int, Int>): Int? {
            if (formatId == null || !formatId.contains(EXTERNAL_MARK)) return null
            val hash = formatId.substringAfterLast(':').toIntOrNull() ?: return null
            return hashes[hash]
        }

        private const val EXTERNAL_MARK = "ext:"

        /**
         * The name 2160 gets for a subtitle file: the label plus the file's extension (it takes the MIME type
         * from the extension and the label from the rest); «Субтитры n» when the file has no label.
         */
        fun subtitleName(label: String, ext: String, n: Int): String {
            val e = ext.lowercase(Locale.ROOT).trimStart('.')
            val l = label.ifBlank { "sub${n + 1}" }
            return "$l.$e"
        }

        fun subMime(ext: String): String? = when (ext.lowercase(Locale.ROOT).trimStart('.')) {
            "srt" -> MimeTypes.APPLICATION_SUBRIP
            "ass", "ssa" -> MimeTypes.TEXT_SSA
            "vtt" -> MimeTypes.TEXT_VTT
            else -> null
        }

        /** A track as an [EngineTrack]; [external] is the subtitle file's index ([externalIndex]), null when embedded. */
        fun trackOf(
            id: String,
            external: Int?,
            language: String?,
            label: String?,
            mime: String?,
            channelCount: Int,
            selected: Boolean,
        ): EngineTrack = EngineTrack(
            id = id,
            language = language,
            label = label,
            codec = codecName(mime),
            channels = if (channelCount == Format.NO_VALUE) 0 else channelCount,
            selected = selected,
            external = external,
        )

        fun codecName(mime: String?): String = when (mime) {
            MimeTypes.AUDIO_AC3 -> "AC3"
            MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC -> "E-AC3"
            MimeTypes.AUDIO_AC4 -> "AC4"
            MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD, MimeTypes.AUDIO_DTS_EXPRESS, MimeTypes.AUDIO_DTS_UHD_P2 -> "DTS"
            MimeTypes.AUDIO_TRUEHD -> "TrueHD"
            MimeTypes.AUDIO_AAC -> "AAC"
            MimeTypes.AUDIO_MPEG, MimeTypes.AUDIO_MPEG_L2 -> "MP3"
            MimeTypes.AUDIO_OPUS -> "Opus"
            MimeTypes.AUDIO_FLAC -> "FLAC"
            MimeTypes.AUDIO_VORBIS -> "Vorbis"
            MimeTypes.AUDIO_RAW -> "PCM"
            else -> ""
        }

        /** PlaybackException.errorCode → [ErrorKind] (the same groups as with OMP's earlier Media3 engine). */
        fun errorKind(code: Int): ErrorKind = when (code) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            PlaybackException.ERROR_CODE_TIMEOUT -> ErrorKind.NETWORK
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED -> ErrorKind.UNSUPPORTED_FORMAT
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED -> ErrorKind.DECODER
            // DECODING_FAILED stays OTHER (its text); «Авто» still switches on it before the first frame (detail)
            else -> ErrorKind.OTHER
        }

        /**
         * user:password@ in [url] → the URL without them and an «Authorization: Basic» header (TorrServer auth; 2160
         * sends the request headers with the stream and the subtitle files). No credentials: the URL, no headers.
         */
        fun splitCredentials(url: String): Pair<String, Map<String, String>> {
            val scheme = url.indexOf("://")
            if (scheme < 0) return url to emptyMap()
            val from = scheme + 3
            var to = url.length
            for (ch in charArrayOf('/', '?', '#')) {
                val k = url.indexOf(ch, from)
                if (k in from until to) to = k
            }
            val at = url.lastIndexOf('@', to - 1)
            if (at < from) return url to emptyMap()
            val info = url.substring(from, at)
            val user = percentDecode(info.substringBefore(':'))
            val pass = percentDecode(info.substringAfter(':', ""))
            val token = Base64.getEncoder().encodeToString("$user:$pass".toByteArray(Charsets.UTF_8))
            return (url.substring(0, from) + url.substring(at + 1)) to mapOf("Authorization" to "Basic $token")
        }

        /** %XX sequences as UTF-8 bytes; anything else (a «+» too) as it is. */
        fun percentDecode(s: String): String {
            if ('%' !in s) return s
            val out = java.io.ByteArrayOutputStream()
            var i = 0
            while (i < s.length) {
                val c = s[i]
                val hex = if (c == '%' && i + 2 < s.length) s.substring(i + 1, i + 3).toIntOrNull(16) else null
                if (hex != null) {
                    out.write(hex)
                    i += 3
                } else {
                    out.write(c.toString().toByteArray(Charsets.UTF_8))
                    i++
                }
            }
            return out.toString(Charsets.UTF_8.name())
        }
    }
}
