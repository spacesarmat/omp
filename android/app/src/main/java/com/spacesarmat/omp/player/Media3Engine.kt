package com.spacesarmat.omp.player

import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.util.Base64
import android.util.Log
import android.view.ViewGroup
import androidx.annotation.OptIn
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
import androidx.media3.common.util.Util
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.decoder.ffmpeg.FfmpegAudioRenderer
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.video.VideoRendererEventListener
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.util.Locale

/**
 * [PlayerEngine] on Media3 ExoPlayer. Audio the device cannot decode (DTS, TrueHD, AC3/E-AC3 on boxes without
 * those decoders) goes through the FFmpeg decoder of org.jellyfin.media3:media3-ffmpeg-decoder ([OmpRenderers]);
 * AC3/E-AC3/DTS still go out as passthrough over HDMI when the device reports support. Video always uses the
 * device decoders.
 */
@OptIn(UnstableApi::class)
class Media3Engine(private val context: Context) : PlayerEngine {
    override var listener: PlayerEngine.Listener? = null

    private val exo: ExoPlayer = build()
    private var view: PlayerView? = null

    /** onEnded once per end (the player may report the end both as a pause and as STATE_ENDED). */
    private var endSent = false

    /** onFirstFrame once per opened item (a rendered frame, or the first READY of media without video). */
    private var frameSent = false

    /** Last buffering flag reported (onBuffering only on a change). */
    private var buffering = false

    private fun build(): ExoPlayer {
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("OMP")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(30_000)
            .setReadTimeoutMs(60_000)
        // TorrServer Basic auth: credentials come in the URL (as for <video> on LG) and go out as a header
        val auth = ResolvingDataSource.Factory(http) { spec -> withBasicAuth(spec) }
        val sources = DefaultMediaSourceFactory(DefaultDataSource.Factory(context, auth))
        val attrs = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build()
        // the buffer fits the heap: the default (≈131 MB for video) does not fit a 128 MB box and 4K died of OOM
        val cap = PlayerBuffer.capBytes(PlayerBuffer.memoryClassMb(context))
        val load = DefaultLoadControl.Builder()
            .setTargetBufferBytes(cap)
            .setPrioritizeTimeOverSizeThresholds(false)
            .build()
        Log.i(TAG, "buffer cap ${cap / (1024 * 1024)} MB")
        val p = ExoPlayer.Builder(context, OmpRenderers(context))
            .setLoadControl(load)
            .setMediaSourceFactory(sources)
            .setAudioAttributes(attrs, true)
            .setHandleAudioBecomingNoisy(true)
            .build()
        // the end of an item pauses (the UI decides: countdown or close)
        p.pauseAtEndOfMediaItems = true
        p.addAnalyticsListener(object : AnalyticsListener {
            override fun onAudioTrackInitialized(eventTime: AnalyticsListener.EventTime, audioTrackConfig: AudioSink.AudioTrackConfig) {
                outputEncoding = audioTrackConfig.encoding
            }
        })
        p.addListener(object : Player.Listener {
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) ended()
                listener?.onPlayingChanged(playWhenReady)
            }

            override fun onPlaybackStateChanged(state: Int) {
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
                // out of memory (wrapped in a source error): «Авто» may still move the item to VLC
                listener?.onError(errorKind(e.errorCode), if (PlayerBuffer.causedByOom(e)) EngineChooser.OUT_OF_MEMORY else e.errorCodeName)
            }
        })
        return p
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
            player = exo
        }
        container.addView(v, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        view = v
    }

    override fun setPreferences(prefs: TrackPrefs) {
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
            .clearOverrides()
            .setPreferredAudioLanguage(prefs.audioLang.ifEmpty { null })
            .setPreferredTextLanguage(prefs.subLang.ifEmpty { null })
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !prefs.subtitlesOn)
            .build()
    }

    override fun open(media: EngineMedia, startMs: Long) {
        endSent = false
        frameSent = false
        exo.setMediaItem(mediaItem(media), startMs.coerceAtLeast(0L))
        exo.prepare()
        exo.playWhenReady = true
    }

    override fun play() {
        endSent = false
        exo.play()
    }

    override fun pause() = exo.pause()

    override fun seekTo(ms: Long) {
        endSent = false
        exo.seekTo(ms)
    }

    override fun retry() {
        endSent = false
        exo.prepare()
        exo.play()
    }

    override val positionMs: Long get() = exo.currentPosition.coerceAtLeast(0L)

    override val durationMs: Long get() = exo.duration.let { if (it == C.TIME_UNSET || it < 0) 0L else it }

    override val playWhenReady: Boolean get() = exo.playWhenReady

    override val isBuffering: Boolean get() = exo.playbackState == Player.STATE_BUFFERING

    override fun audioTracks(): List<EngineTrack> = tracksOf(C.TRACK_TYPE_AUDIO)

    override fun subtitleTracks(): List<EngineTrack> = tracksOf(C.TRACK_TYPE_TEXT)

    /** The encoding of the audio output (AnalyticsListener): a non-PCM one means passthrough over HDMI. */
    private var outputEncoding: Int? = null

    override fun mediaInfo(): EngineMediaInfo {
        val v = exo.videoFormat
        val ahead = exo.bufferedPosition - exo.currentPosition
        return EngineMediaInfo(
            videoCodec = PlayerInfoText.videoCodec(v?.sampleMimeType),
            width = v?.width?.takeIf { it > 0 } ?: 0,
            height = v?.height?.takeIf { it > 0 } ?: 0,
            hdr = if (v == null) "" else hdrOf(v.sampleMimeType, v.colorInfo?.colorTransfer),
            bitrate = (v?.bitrate?.takeIf { it > 0 } ?: v?.averageBitrate?.takeIf { it > 0 } ?: 0).toLong(),
            passthrough = outputEncoding?.let { !Util.isEncodingLinearPcm(it) },
            bufferedMs = if (ahead >= 0) ahead else -1,
        )
    }

    /** Supported groups of [type]; the id is the group's place in currentTracks («g<n>»). */
    private fun tracksOf(type: Int): List<EngineTrack> {
        val out = ArrayList<EngineTrack>()
        exo.currentTracks.groups.forEachIndexed { n, g ->
            if (g.type == type && g.isSupported) out.add(track("g$n", g.getTrackFormat(0), g.isSelected))
        }
        return out
    }

    private fun group(id: String, type: Int): Tracks.Group? {
        val n = id.removePrefix("g").toIntOrNull() ?: return null
        return exo.currentTracks.groups.getOrNull(n)?.takeIf { it.type == type }
    }

    override fun selectAudio(id: String) {
        val g = group(id, C.TRACK_TYPE_AUDIO) ?: return
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0))
            .build()
    }

    override fun selectSubtitle(id: String?) {
        val b = exo.trackSelectionParameters.buildUpon()
        if (id == null) {
            b.clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            val g = group(id, C.TRACK_TYPE_TEXT) ?: return
            b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0))
        }
        exo.trackSelectionParameters = b.build()
    }

    override fun release() {
        listener = null
        view?.let { v ->
            v.player = null
            (v.parent as? ViewGroup)?.removeView(v)
        }
        view = null
        exo.release()
    }

    /**
     * Renderers with the FFmpeg audio decoder after the device's MediaCodec one (the order of
     * EXTENSION_RENDERER_MODE_ON): MediaCodec keeps hardware decoding and HDMI passthrough, FFmpeg takes only the
     * formats the device cannot play. PREFER would put FFmpeg first and turn AC3/DTS passthrough into PCM.
     * Video renderers are built without extensions: the AAR also carries an experimental FFmpeg video renderer,
     * a software decoder that must not replace the TV's hardware one.
     */
    private class OmpRenderers(context: Context) : DefaultRenderersFactory(context) {
        init {
            setEnableDecoderFallback(true)
        }

        override fun buildAudioRenderers(
            context: Context,
            extensionRendererMode: Int,
            mediaCodecSelector: MediaCodecSelector,
            enableDecoderFallback: Boolean,
            audioSink: AudioSink,
            eventHandler: Handler,
            eventListener: AudioRendererEventListener,
            out: ArrayList<Renderer>,
        ) {
            super.buildAudioRenderers(context, EXTENSION_RENDERER_MODE_OFF, mediaCodecSelector, enableDecoderFallback, audioSink, eventHandler, eventListener, out)
            if (FfmpegLibrary.isAvailable()) {
                out.add(FfmpegAudioRenderer(eventHandler, eventListener, audioSink))
            } else {
                Log.w(TAG, "FFmpeg audio decoder unavailable")
            }
        }

        override fun buildVideoRenderers(
            context: Context,
            extensionRendererMode: Int,
            mediaCodecSelector: MediaCodecSelector,
            enableDecoderFallback: Boolean,
            eventHandler: Handler,
            eventListener: VideoRendererEventListener,
            allowedVideoJoiningTimeMs: Long,
            out: ArrayList<Renderer>,
        ) = super.buildVideoRenderers(context, EXTENSION_RENDERER_MODE_OFF, mediaCodecSelector, enableDecoderFallback, eventHandler, eventListener, allowedVideoJoiningTimeMs, out)
    }

    companion object {
        private const val TAG = "OmpPlayer"
        private const val EXTERNAL_ID = "omp-x"
        private val EXTERNAL_RE = Regex("omp-x(\\d+)")

        private fun mediaItem(m: EngineMedia): MediaItem {
            val subs = ArrayList<MediaItem.SubtitleConfiguration>()
            m.subtitles.forEachIndexed { n, s ->
                val mime = subMime(s.ext) ?: return@forEachIndexed
                if (s.url.isEmpty()) return@forEachIndexed
                val b = MediaItem.SubtitleConfiguration.Builder(Uri.parse(s.url))
                    .setMimeType(mime)
                    .setLabel(s.label)
                    .setId(EXTERNAL_ID + n)
                if (s.lang.isNotEmpty()) b.setLanguage(s.lang)
                subs.add(b.build())
            }
            return MediaItem.Builder().setUri(m.url).setMediaId("omp").setSubtitleConfigurations(subs).build()
        }

        fun subMime(ext: String): String? = when (ext.lowercase(Locale.ROOT).trimStart('.')) {
            "srt" -> MimeTypes.APPLICATION_SUBRIP
            "ass", "ssa" -> MimeTypes.TEXT_SSA
            "vtt" -> MimeTypes.TEXT_VTT
            else -> null
        }

        /** A Media3 track format as an [EngineTrack]. */
        fun track(id: String, f: Format, selected: Boolean): EngineTrack =
            trackOf(id, f.id, f.language, f.label, f.sampleMimeType, f.channelCount, selected)

        /** [formatId] «…omp-x<n>…» marks the item's subtitle file n (side-loaded with that id). */
        fun trackOf(
            id: String,
            formatId: String?,
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
            external = formatId?.let { EXTERNAL_RE.find(it) }?.groupValues?.get(1)?.toIntOrNull(),
        )

        /** «HDR10», «HLG», «Dolby Vision» from the video MIME type and its colour transfer; '' for SDR / unknown. */
        fun hdrOf(mime: String?, transfer: Int?): String = when {
            mime == MimeTypes.VIDEO_DOLBY_VISION -> "Dolby Vision"
            transfer == C.COLOR_TRANSFER_ST2084 -> "HDR10"
            transfer == C.COLOR_TRANSFER_HLG -> "HLG"
            else -> ""
        }

        fun codecName(mime: String?): String = when (mime) {
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

        /** PlaybackException.errorCode → [ErrorKind] (the same groups as the error texts before the engine split). */
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
    }
}
