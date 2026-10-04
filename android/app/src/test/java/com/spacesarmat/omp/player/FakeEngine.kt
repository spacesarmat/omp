package com.spacesarmat.omp.player

import android.view.ViewGroup

/** A [PlayerEngine] without video: records calls, the test moves the position and fires the events. */
class FakeEngine : PlayerEngine {
    override var listener: PlayerEngine.Listener? = null

    val opened = ArrayList<Pair<EngineMedia, Long>>()
    var prefs: TrackPrefs? = null
    var retries = 0
    var released = false
    var audio: List<EngineTrack> = emptyList()
    var subs: List<EngineTrack> = emptyList()
    var selectedAudioId: String? = null
    var selectedSubId: String? = "unset"

    override var positionMs = 0L
    override var durationMs = 0L
    override var playWhenReady = false
    override var isBuffering = false

    override fun attach(container: ViewGroup) = Unit

    override fun setPreferences(prefs: TrackPrefs) {
        this.prefs = prefs
    }

    override fun open(media: EngineMedia, startMs: Long) {
        opened.add(media to startMs)
        positionMs = startMs
        durationMs = 0L
        playWhenReady = true
    }

    override fun play() {
        playWhenReady = true
    }

    override fun pause() {
        playWhenReady = false
    }

    override fun seekTo(ms: Long) {
        positionMs = ms
    }

    override fun retry() {
        retries++
        playWhenReady = true
    }

    override fun audioTracks() = audio

    override fun subtitleTracks() = subs

    override fun selectAudio(id: String) {
        selectedAudioId = id
    }

    override fun selectSubtitle(id: String?) {
        selectedSubId = id
    }

    override fun release() {
        released = true
    }
}
