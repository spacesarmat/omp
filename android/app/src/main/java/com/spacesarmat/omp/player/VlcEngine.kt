package com.spacesarmat.omp.player

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.interfaces.IMedia
import org.videolan.libvlc.util.VLCVideoLayout
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs

/**
 * [PlayerEngine] on libVLC (org.videolan.android:libvlc-all, LGPL-2.1): nearly every container and codec, ASS/SSA
 * subtitles with their styles (libass, drawn on the subtitle surface of [VLCVideoLayout]), hardware video decoding.
 * Created only when [VlcAvailability] said yes; the LibVLC instance is the activity's ([VlcLibrary]).
 *
 * Threads: player calls (setMedia, play, pause, seek, track selection, slaves, stop, release) run on [VlcThread]
 * in order — setMedia / stop join libVLC's input thread and can block on a stalled stream. Events arrive on the main
 * thread. The main thread reads libVLC (track lists) only while no call is in flight (libVLC holds the input lock
 * during them); time and length come from the events. Events of the media being replaced are ignored ([gen]).
 *
 * TorrServer credentials stay in the URL (user:password@): libVLC 3 has no request-header option, its HTTP access
 * answers the server's 401 Basic challenge with the URL's credentials and keeps sending them on the reconnects of
 * a seek.
 *
 * Tracks: VLC's ES ids («a<id>», «s<id>»); language / codec / channels from the media's track list when known,
 * else parsed from the track name. The item's subtitle files are added as slaves one at a time once the item plays;
 * a new subtitle ES is the file whose name it carries, else the file being added ([VlcSupport.externalFor]).
 */
class VlcEngine(library: VlcLibrary) : PlayerEngine {
    override var listener: PlayerEngine.Listener? = null

    private val lib = library.get()
    private val mp = MediaPlayer(lib)
    private val main = Handler(Looper.getMainLooper())
    private var layout: VLCVideoLayout? = null
    private var viewsAttached = false
    private var released = false

    private var item: EngineMedia? = null
    private var media: Media? = null
    private var prefs = TrackPrefs("", "", false)
    private var audioChoice: VlcSupport.Choice? = null
    private var subChoice: VlcSupport.Choice? = null

    /** Calls queued or running on [VlcThread]. */
    private val busy = AtomicInteger()
    /** Track lists to read again once no call is in flight. */
    private var dirty = false
    /** The item opened last ([gen]) and the one whose events count ([liveGen], set once its setMedia is done). */
    private var gen = 0
    private var liveGen = 0

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
    private var timeMs = -1L
    private var lengthMs = 0L
    /** Seek requested before the item plays / after its end (applied on Playing / by [play]). */
    private var seekBeforeStart: Long? = null
    private var restartAt: Long? = null
    /** Target of the last seek until VLC reports a time near it (positionMs must show it at once). */
    private var seekTarget: Long? = null
    private var seekAt = 0L
    private var audioDesc: List<MediaPlayer.TrackDescription> = emptyList()
    private var spuDesc: List<MediaPlayer.TrackDescription> = emptyList()
    private var selAudio = -1
    private var selSpu = -1
    private var videoCount = 0
    private var info: Map<Int, IMedia.Track> = emptyMap()
    private var slavesStarted = false
    private val embeddedSpu = HashSet<Int>()
    /** Subtitle ES id → index of the item's file. */
    private val externalIds = HashMap<Int, Int>()
    private val slaveQueue = ArrayDeque<Int>()
    private var inFlight: Int? = null
    private val slaveTimeout = Runnable {
        inFlight = null
        addNextSlave()
    }
    private var audioDecided = false
    private var subDecided = false

    init {
        mp.setEventListener { e -> onEvent(e) }
    }

    /** Runs [block] on the libVLC thread; the track lists are read again afterwards when something changed. */
    private fun call(block: () -> Unit) {
        busy.incrementAndGet()
        VlcThread.post {
            try {
                block()
            } finally {
                busy.decrementAndGet()
                main.post { if (!released && dirty) refresh() }
            }
        }
    }

    override fun attach(container: ViewGroup) {
        val v = VLCVideoLayout(container.context).apply { isFocusable = false }
        container.addView(v, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        layout = v
        attachWhenSized()
    }

    /**
     * The video output goes on once the layout has its size: attached at 0×0 (the view was just added, not laid out)
     * libVLC logs «Invalid surface size» and on some boxes (Dune HD) never shows a picture.
     */
    private fun attachWhenSized() {
        val v = layout ?: return
        if (VlcSupport.surfaceReady(v.width, v.height)) {
            attachViews()
            return
        }
        v.addOnLayoutChangeListener(object : View.OnLayoutChangeListener {
            override fun onLayoutChange(view: View, l: Int, t: Int, r: Int, b: Int, ol: Int, ot: Int, or: Int, ob: Int) {
                if (!VlcSupport.surfaceReady(r - l, b - t)) return
                view.removeOnLayoutChangeListener(this)
                if (!released && layout === view) attachViews()
            }
        })
    }

    private fun attachViews() {
        val v = layout ?: return
        if (viewsAttached) return
        // subtitles on their own surface (ASS styles), SurfaceView (no texture view: lower cost on TV boxes)
        mp.attachViews(v, null, true, false)
        mp.videoScale = MediaPlayer.ScaleType.SURFACE_BEST_FIT
        viewsAttached = true
    }

    /** The SurfaceView goes away while the activity is stopped: views detached, attached again in [hostStarted]. */
    override fun hostStopped() {
        if (!viewsAttached) return
        mp.detachViews()
        viewsAttached = false
    }

    override fun hostStarted() {
        if (!released) attachWhenSized()
    }

    override fun setPreferences(prefs: TrackPrefs) {
        this.prefs = prefs
        audioChoice = null
        subChoice = null
    }

    override fun open(media: EngineMedia, startMs: Long) {
        item = media
        start(media, startMs.coerceAtLeast(0L))
    }

    private fun start(m: EngineMedia, at: Long) {
        startMs = at
        played = false
        opened = false
        frameSent = false
        endSent = false
        ended = false
        endPos = 0L
        timeMs = -1L
        lengthMs = 0L
        seekBeforeStart = null
        restartAt = null
        seekTarget = null
        audioDesc = emptyList()
        spuDesc = emptyList()
        selAudio = -1
        selSpu = -1
        videoCount = 0
        info = emptyMap()
        slavesStarted = false
        embeddedSpu.clear()
        externalIds.clear()
        slaveQueue.clear()
        inFlight = null
        main.removeCallbacks(slaveTimeout)
        audioDecided = false
        subDecided = false
        dirty = false
        setBuffering(true)
        val md = Media(lib, Uri.parse(m.url))
        md.setHWDecoderEnabled(true, false)
        md.addOption(":network-caching=$NETWORK_CACHING_MS")
        if (at > 0) md.addOption(VlcSupport.startOption(at))
        media = md
        val g = ++gen
        setWant(true)
        call {
            mp.media = md
            // the player holds its own reference; ours stays valid while it is the player's media
            md.release()
            // queued before play(): the new media's events come after it
            main.post { liveGen = g }
            mp.play()
        }
    }

    override fun play() {
        val r = restartAt
        if (r != null || ended) {
            item?.let { start(it, r ?: 0L) }
            return
        }
        setWant(true)
        if (played) call { mp.play() }
    }

    override fun pause() {
        setWant(false)
        if (played) call { if (mp.isPlaying) mp.pause() }
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
        if (played) call { mp.setTime(t) } else seekBeforeStart = t
    }

    override fun retry() {
        val m = item ?: return
        start(m, positionMs)
    }

    override val positionMs: Long
        get() {
            restartAt?.let { return it }
            if (ended) return endPos
            seekTarget?.let { t ->
                if (!played || SystemClock.uptimeMillis() - seekAt < SEEK_HOLD_MS) return t
                seekTarget = null
            }
            return if (timeMs >= 0 && played) timeMs else startMs
        }

    override val durationMs: Long get() = lengthMs

    override val playWhenReady: Boolean get() = wantPlay

    override val isBuffering: Boolean get() = buffering

    override fun audioTracks(): List<EngineTrack> {
        if (!played) return emptyList()
        return audioDesc.map { d ->
            val t = info[d.id]
            val parsed = VlcSupport.parseName(d.name)
            EngineTrack(
                id = "a${d.id}",
                language = VlcSupport.lang(t?.language) ?: parsed.language,
                label = t?.description?.takeIf { it.isNotBlank() } ?: parsed.label,
                codec = VlcSupport.codecName(t?.codec),
                channels = (t as? IMedia.AudioTrack)?.channels ?: 0,
                selected = d.id == selAudio,
            )
        }
    }

    /** The video track of the media (libVLC 3 has no HDR transfer info nor the audio output mode: left out). */
    override fun mediaInfo(): EngineMediaInfo {
        val v = info.values.firstOrNull { it.type == IMedia.Track.Type.Video } as? IMedia.VideoTrack ?: return EngineMediaInfo()
        return EngineMediaInfo(
            videoCodec = PlayerInfoText.videoCodec(v.codec),
            width = v.width.coerceAtLeast(0),
            height = v.height.coerceAtLeast(0),
            bitrate = v.bitrate.toLong().coerceAtLeast(0L),
        )
    }

    override fun subtitleTracks(): List<EngineTrack> {
        if (!played) return emptyList()
        val files = item?.subtitles ?: emptyList()
        return spuDesc.map { d ->
            val x = externalIds[d.id]
            if (x != null) {
                val f = files.getOrNull(x)
                EngineTrack("s${d.id}", VlcSupport.lang(f?.lang), f?.label, selected = d.id == selSpu, external = x)
            } else {
                val t = info[d.id]
                val parsed = VlcSupport.parseName(d.name)
                EngineTrack(
                    id = "s${d.id}",
                    language = VlcSupport.lang(t?.language) ?: parsed.language,
                    label = t?.description?.takeIf { it.isNotBlank() } ?: parsed.label,
                    selected = d.id == selSpu,
                )
            }
        }
    }

    private fun setAudio(es: Int) {
        selAudio = es
        dirty = true
        call { mp.setAudioTrack(es) }
    }

    private fun setSpu(es: Int) {
        selSpu = es
        dirty = true
        call { mp.setSpuTrack(es) }
    }

    override fun selectAudio(id: String) {
        val es = id.removePrefix("a").toIntOrNull() ?: return
        audioChoice = VlcSupport.choiceOf(audioTracks().firstOrNull { it.id == id } ?: return)
        setAudio(es)
        listener?.onTracksChanged()
    }

    override fun selectSubtitle(id: String?) {
        if (id == null) {
            subChoice = VlcSupport.Choice.Off
            setSpu(-1)
        } else {
            val es = id.removePrefix("s").toIntOrNull() ?: return
            subChoice = VlcSupport.choiceOf(subtitleTracks().firstOrNull { it.id == id } ?: return)
            setSpu(es)
        }
        subDecided = true
        listener?.onTracksChanged()
    }

    /** Views and listener go now; stop and release on the libVLC thread (the LibVLC itself: [VlcLibrary.release]). */
    override fun release() {
        if (released) return
        released = true
        listener = null
        gen++
        main.removeCallbacks(slaveTimeout)
        mp.setEventListener(null)
        if (viewsAttached) mp.detachViews()
        viewsAttached = false
        layout?.let { v -> (v.parent as? ViewGroup)?.removeView(v) }
        layout = null
        media = null
        val p = mp
        VlcThread.post {
            p.stop()
            p.release()
        }
    }

    // ---- events (main thread) ----

    private fun onEvent(e: MediaPlayer.Event) {
        if (released || liveGen != gen) return
        when (e.type) {
            MediaPlayer.Event.Opening -> setBuffering(true)
            MediaPlayer.Event.Buffering -> setBuffering(e.buffering < 100f)
            MediaPlayer.Event.ESAdded -> onEsAdded(e.esChangedType)
            MediaPlayer.Event.ESDeleted, MediaPlayer.Event.ESSelected -> if (played) refreshSoon()
            MediaPlayer.Event.Playing -> onPlaying()
            MediaPlayer.Event.Vout -> if (e.voutCount > 0) firstFrame()
            MediaPlayer.Event.TimeChanged -> {
                timeMs = e.timeChanged
                seekTarget?.let { if (abs(e.timeChanged - it) < SEEK_NEAR_MS) seekTarget = null }
            }
            MediaPlayer.Event.LengthChanged -> lengthMs = e.lengthChanged.coerceAtLeast(0L)
            MediaPlayer.Event.EndReached -> onEnd()
            MediaPlayer.Event.EncounteredError -> {
                setBuffering(false)
                setWant(false)
                listener?.onError(VlcSupport.errorKind(opened, played), "vlc_error")
            }
        }
    }

    private fun onEsAdded(type: Int) {
        opened = true
        if (played || type == IMedia.Track.Type.Text) refreshSoon()
    }

    private fun onPlaying() {
        setBuffering(false)
        played = true
        opened = true
        seekBeforeStart?.let { t -> call { mp.setTime(t) } }
        seekBeforeStart = null
        if (!wantPlay) call { if (mp.isPlaying) mp.pause() }
        refreshSoon()
        listener?.onReady()
    }

    /** Reads the track lists now when no call is in flight, else right after the calls. */
    private fun refreshSoon() {
        dirty = true
        if (busy.get() == 0) refresh()
    }

    /** Track lists, selection, file subtitles and the preferences (main thread, no call in flight). */
    private fun refresh() {
        if (released || busy.get() != 0 || liveGen != gen) return
        dirty = false
        if (!played) return
        audioDesc = (mp.audioTracks ?: emptyArray()).filter { it.id >= 0 }
        spuDesc = (mp.spuTracks ?: emptyArray()).filter { it.id >= 0 }
        selAudio = mp.audioTrack
        selSpu = mp.spuTrack
        videoCount = mp.videoTracksCount
        if (info.isEmpty()) info = readInfo()
        if (lengthMs <= 0) lengthMs = mp.length.coerceAtLeast(0L)
        if (videoCount <= 0 && audioDesc.isNotEmpty()) firstFrame()
        if (!slavesStarted) {
            // the subtitles known when the item starts are the file's own
            slavesStarted = true
            spuDesc.forEach { embeddedSpu.add(it.id) }
            item?.subtitles?.forEachIndexed { n, s -> if (s.url.isNotEmpty()) slaveQueue.addLast(n) }
            addNextSlave()
        } else {
            mapExternal()
        }
        applyTracks()
        listener?.onTracksChanged()
    }

    /** New subtitle ES after the start: the file named in it, else the file being added; others are the file's own. */
    private fun mapExternal() {
        val files = item?.subtitles ?: return
        for (d in spuDesc) {
            if (d.id in embeddedSpu || d.id in externalIds) continue
            val x = VlcSupport.externalFor(d.name, files, inFlight, externalIds.values)
            if (x == null) {
                embeddedSpu.add(d.id)
                continue
            }
            externalIds[d.id] = x
            slaveQueue.remove(x)
            if (x == inFlight) {
                main.removeCallbacks(slaveTimeout)
                inFlight = null
                addNextSlave()
            }
        }
    }

    /** Adds the next subtitle file; the next one follows once its ES appears or after [SLAVE_TIMEOUT_MS]. */
    private fun addNextSlave() {
        if (inFlight != null) return
        val n = slaveQueue.removeFirstOrNull() ?: return
        val url = item?.subtitles?.getOrNull(n)?.url ?: return
        inFlight = n
        main.postDelayed(slaveTimeout, SLAVE_TIMEOUT_MS)
        call { mp.addSlave(IMedia.Slave.Type.Subtitle, Uri.parse(url), false) }
    }

    /** The media's track list (language codes, codecs, channels) by ES id; empty when libVLC has none yet. */
    private fun readInfo(): Map<Int, IMedia.Track> {
        val md = media ?: return emptyMap()
        if (md.isReleased) return emptyMap()
        val out = HashMap<Int, IMedia.Track>()
        for (i in 0 until md.trackCount) md.getTrack(i)?.let { out[it.id] = it }
        return out
    }

    /** Audio / subtitles by the user's choice or the preferred languages, once per item (subtitles: once known). */
    private fun applyTracks() {
        if (!audioDecided) {
            val list = audioTracks()
            if (list.isNotEmpty()) {
                audioDecided = true
                VlcSupport.pickAudio(list, audioChoice, prefs.audioLang)?.let { t ->
                    if (!t.selected) t.id.removePrefix("a").toIntOrNull()?.let { setAudio(it) }
                }
            }
        }
        if (!subDecided) {
            val pick = VlcSupport.pickSub(subtitleTracks(), subChoice, prefs)
            val t = pick.track
            when {
                pick.off -> {
                    subDecided = true
                    if (selSpu >= 0) setSpu(-1)
                }
                t != null -> {
                    subDecided = true
                    if (!t.selected) t.id.removePrefix("s").toIntOrNull()?.let { setSpu(it) }
                }
                // no match yet: the files may still come; VLC's own choice meanwhile
                slavesStarted && inFlight == null && slaveQueue.isEmpty() -> subDecided = true
            }
        }
    }

    private fun onEnd() {
        endPos = lengthMs.coerceAtLeast(positionMs)
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
        private const val SLAVE_TIMEOUT_MS = 5000L
    }
}
