package com.spacesarmat.omp.player

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.view.ViewGroup
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.interfaces.IMedia
import org.videolan.libvlc.util.VLCVideoLayout
import kotlin.math.abs

/**
 * [PlayerEngine] on libVLC (org.videolan.android:libvlc-all, LGPL-2.1): nearly every container and codec, ASS/SSA
 * subtitles with their styles (libass, drawn on the subtitle surface of [VLCVideoLayout]), hardware video decoding.
 *
 * TorrServer credentials stay in the URL (user:password@): libVLC 3 has no request-header option, its HTTP access
 * answers the server's 401 Basic challenge with the URL's credentials and keeps sending them on the reconnects of
 * a seek. libVLC logging is off (`--verbose=-1`): its messages may carry the URL.
 *
 * Tracks: VLC's ES ids («a<id>», «s<id>»); language / codec / channels from the media's track list when known,
 * else parsed from the track name. The item's subtitle files are added as slaves once the item plays; the
 * subtitle ES that appear after that are the files, in order.
 */
class VlcEngine(context: Context) : PlayerEngine {
    override var listener: PlayerEngine.Listener? = null

    private val libVlc = LibVLC(context.applicationContext, OPTIONS)
    private val mp = MediaPlayer(libVlc)
    private var layout: VLCVideoLayout? = null

    private var item: EngineMedia? = null
    private var media: Media? = null
    private var prefs = TrackPrefs("", "", false)
    private var audioChoice: VlcSupport.Choice? = null
    private var subChoice: VlcSupport.Choice? = null

    // ---- per open ----
    private var startMs = 0L
    private var wantPlay = false
    private var buffering = false
    private var played = false
    private var opened = false
    private var frameSent = false
    private var endSent = false
    private var ended = false
    private var endPos = 0L
    /** Seek requested before the item plays / after its end (applied on Playing / by [play]). */
    private var seekBeforeStart: Long? = null
    private var restartAt: Long? = null
    /** Target of the last seek until VLC reports a time near it (positionMs must show it at once). */
    private var seekTarget: Long? = null
    private var seekAt = 0L
    private var slavesAdded = false
    private val embeddedSpu = HashSet<Int>()
    /** Subtitle ES id → index of the item's file. */
    private val externalIds = HashMap<Int, Int>()
    private val pendingExternal = ArrayDeque<Int>()
    private var info: Map<Int, IMedia.Track> = emptyMap()
    private var audioDecided = false
    private var subDecided = false

    init {
        mp.setEventListener { e -> onEvent(e) }
    }

    override fun attach(container: ViewGroup) {
        val v = VLCVideoLayout(container.context).apply { isFocusable = false }
        container.addView(v, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // subtitles on their own surface (ASS styles), SurfaceView (no texture view: lower cost on TV boxes)
        mp.attachViews(v, null, true, false)
        mp.videoScale = MediaPlayer.ScaleType.SURFACE_BEST_FIT
        layout = v
    }

    override fun setPreferences(prefs: TrackPrefs) {
        this.prefs = prefs
        audioChoice = null
        subChoice = null
    }

    override fun open(media: EngineMedia, startMs: Long) {
        item = media
        start(media, startMs.coerceAtLeast(0L), play = true)
    }

    private fun start(m: EngineMedia, at: Long, play: Boolean) {
        startMs = at
        played = false
        opened = false
        frameSent = false
        endSent = false
        ended = false
        endPos = 0L
        seekBeforeStart = null
        restartAt = null
        seekTarget = null
        slavesAdded = false
        embeddedSpu.clear()
        externalIds.clear()
        pendingExternal.clear()
        info = emptyMap()
        audioDecided = false
        subDecided = false
        setBuffering(true)
        val md = Media(libVlc, Uri.parse(m.url))
        md.setHWDecoderEnabled(true, false)
        md.addOption(":network-caching=$NETWORK_CACHING_MS")
        if (at > 0) md.addOption(VlcSupport.startOption(at))
        mp.media = md
        // the player holds its own reference; ours stays valid while it is the player's media
        md.release()
        media = md
        setWant(play)
        mp.play()
    }

    override fun play() {
        val r = restartAt
        if (r != null || ended) {
            item?.let { start(it, r ?: 0L, play = true) }
            return
        }
        setWant(true)
        if (played) mp.play()
    }

    override fun pause() {
        setWant(false)
        if (played && mp.isPlaying) mp.pause()
    }

    override fun seekTo(ms: Long) {
        val t = ms.coerceAtLeast(0L)
        endSent = false
        if (ended || restartAt != null) {
            restartAt = t
            return
        }
        seekTarget = t
        seekAt = SystemClock.uptimeMillis()
        if (played) mp.setTime(t) else seekBeforeStart = t
    }

    override fun retry() {
        val m = item ?: return
        start(m, positionMs, play = true)
    }

    override val positionMs: Long
        get() {
            restartAt?.let { return it }
            if (ended) return endPos
            seekTarget?.let { t ->
                if (!played || SystemClock.uptimeMillis() - seekAt < SEEK_HOLD_MS) return t
                seekTarget = null
            }
            val t = mp.time
            return if (t >= 0 && played) t else startMs
        }

    override val durationMs: Long get() = mp.length.coerceAtLeast(0L)

    override val playWhenReady: Boolean get() = wantPlay

    override val isBuffering: Boolean get() = buffering

    override fun audioTracks(): List<EngineTrack> {
        if (!played) return emptyList()
        val sel = mp.audioTrack
        return (mp.audioTracks ?: return emptyList()).filter { it.id >= 0 }.map { d ->
            val t = info[d.id]
            val parsed = VlcSupport.parseName(d.name)
            EngineTrack(
                id = "a${d.id}",
                language = VlcSupport.lang(t?.language) ?: parsed.language,
                label = t?.description?.takeIf { it.isNotBlank() } ?: parsed.label,
                codec = VlcSupport.codecName(t?.codec),
                channels = (t as? IMedia.AudioTrack)?.channels ?: 0,
                selected = d.id == sel,
            )
        }
    }

    override fun subtitleTracks(): List<EngineTrack> {
        if (!played) return emptyList()
        val sel = mp.spuTrack
        val files = item?.subtitles ?: emptyList()
        return (mp.spuTracks ?: return emptyList()).filter { it.id >= 0 }.map { d ->
            val x = externalIds[d.id]
            if (x != null) {
                val f = files.getOrNull(x)
                EngineTrack("s${d.id}", VlcSupport.lang(f?.lang), f?.label, selected = d.id == sel, external = x)
            } else {
                val t = info[d.id]
                val parsed = VlcSupport.parseName(d.name)
                EngineTrack(
                    id = "s${d.id}",
                    language = VlcSupport.lang(t?.language) ?: parsed.language,
                    label = t?.description?.takeIf { it.isNotBlank() } ?: parsed.label,
                    selected = d.id == sel,
                )
            }
        }
    }

    override fun selectAudio(id: String) {
        val es = id.removePrefix("a").toIntOrNull() ?: return
        audioChoice = VlcSupport.choiceOf(audioTracks().firstOrNull { it.id == id } ?: return)
        mp.setAudioTrack(es)
        listener?.onTracksChanged()
    }

    override fun selectSubtitle(id: String?) {
        if (id == null) {
            subChoice = VlcSupport.Choice.Off
            mp.setSpuTrack(-1)
        } else {
            val es = id.removePrefix("s").toIntOrNull() ?: return
            subChoice = VlcSupport.choiceOf(subtitleTracks().firstOrNull { it.id == id } ?: return)
            mp.setSpuTrack(es)
        }
        subDecided = true
        listener?.onTracksChanged()
    }

    override fun release() {
        listener = null
        mp.setEventListener(null)
        mp.stop()
        mp.detachViews()
        layout?.let { v -> (v.parent as? ViewGroup)?.removeView(v) }
        layout = null
        media = null
        mp.release()
        libVlc.release()
    }

    // ---- events (main thread) ----

    private fun onEvent(e: MediaPlayer.Event) {
        when (e.type) {
            MediaPlayer.Event.Opening -> setBuffering(true)
            MediaPlayer.Event.Buffering -> setBuffering(e.buffering < 100f)
            MediaPlayer.Event.ESAdded -> onEsAdded(e.esChangedType, e.esChangedID)
            MediaPlayer.Event.ESDeleted, MediaPlayer.Event.ESSelected -> if (played) listener?.onTracksChanged()
            MediaPlayer.Event.Playing -> onPlaying()
            MediaPlayer.Event.Vout -> if (e.voutCount > 0) firstFrame()
            MediaPlayer.Event.TimeChanged -> seekTarget?.let { if (abs(e.timeChanged - it) < SEEK_NEAR_MS) seekTarget = null }
            MediaPlayer.Event.EndReached -> onEnd()
            MediaPlayer.Event.EncounteredError -> {
                setBuffering(false)
                setWant(false)
                listener?.onError(VlcSupport.errorKind(opened, played), "vlc_error")
            }
        }
    }

    private fun onEsAdded(type: Int, id: Int) {
        opened = true
        if (type == IMedia.Track.Type.Text) {
            if (!slavesAdded) embeddedSpu.add(id)
            else if (id !in embeddedSpu && id !in externalIds) pendingExternal.removeFirstOrNull()?.let { externalIds[id] = it }
        }
        if (played) {
            applyTracks()
            listener?.onTracksChanged()
        }
    }

    private fun onPlaying() {
        setBuffering(false)
        val first = !played
        played = true
        opened = true
        if (first) {
            info = readInfo()
            seekBeforeStart?.let { mp.setTime(it) }
            seekBeforeStart = null
            addSlaves()
            if (mp.videoTracksCount <= 0) firstFrame()
            applyTracks()
            listener?.onTracksChanged()
        }
        if (!wantPlay) mp.pause()
        listener?.onReady()
    }

    /** The media's track list (language codes, codecs, channels) by ES id; empty when libVLC has none yet. */
    private fun readInfo(): Map<Int, IMedia.Track> {
        val md = media ?: return emptyMap()
        if (md.isReleased) return emptyMap()
        val out = HashMap<Int, IMedia.Track>()
        for (i in 0 until md.trackCount) md.getTrack(i)?.let { out[it.id] = it }
        return out
    }

    private fun addSlaves() {
        slavesAdded = true
        item?.subtitles?.forEachIndexed { n, s ->
            if (s.url.isEmpty()) return@forEachIndexed
            if (mp.addSlave(IMedia.Slave.Type.Subtitle, Uri.parse(s.url), false)) pendingExternal.addLast(n)
        }
    }

    /** Audio / subtitles by the user's choice or the preferred languages, once per item (subtitles: once known). */
    private fun applyTracks() {
        if (!audioDecided) {
            val list = audioTracks()
            if (list.isNotEmpty()) {
                audioDecided = true
                VlcSupport.pickAudio(list, audioChoice, prefs.audioLang)?.let { t ->
                    if (!t.selected) t.id.removePrefix("a").toIntOrNull()?.let { mp.setAudioTrack(it) }
                }
            }
        }
        if (!subDecided) {
            val pick = VlcSupport.pickSub(subtitleTracks(), subChoice, prefs)
            val t = pick.track
            when {
                pick.off -> {
                    subDecided = true
                    if (mp.spuTrack >= 0) mp.setSpuTrack(-1)
                }
                t != null -> {
                    subDecided = true
                    if (!t.selected) t.id.removePrefix("s").toIntOrNull()?.let { mp.setSpuTrack(it) }
                }
                // no match yet: the files may still come; VLC's own choice meanwhile
                pendingExternal.isEmpty() && slavesAdded -> subDecided = true
            }
        }
    }

    private fun onEnd() {
        endPos = mp.length.coerceAtLeast(positionMs)
        ended = true
        setBuffering(false)
        setWant(false)
        if (!endSent) {
            endSent = true
            listener?.onEnded()
        }
    }

    private fun firstFrame() {
        if (frameSent) return
        frameSent = true
        listener?.onFirstFrame()
    }

    private fun setBuffering(b: Boolean) {
        if (b == buffering) return
        buffering = b
        listener?.onBuffering(b)
    }

    private fun setWant(w: Boolean) {
        if (w == wantPlay) return
        wantPlay = w
        listener?.onPlayingChanged(w)
    }

    companion object {
        private const val NETWORK_CACHING_MS = 3000
        private const val SEEK_HOLD_MS = 3000L
        private const val SEEK_NEAR_MS = 3000L

        /** libVLC options: no log output (its messages may carry the URL with the credentials). */
        private val OPTIONS = arrayListOf("--verbose=-1")
    }
}
