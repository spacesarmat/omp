package com.spacesarmat.omp.player

/**
 * VLC that never gets going: on a weak box (Dune HD, 32-bit Realtek) a 10-bit HEVC file can keep libVLC decoding in
 * software at 100% CPU with the time standing still and no error. The player ticks this while VLC is meant to play;
 * once [LIMIT_MS] of such time pass with the position not moving [PROGRESS_MS] past where the item opened, [tick]
 * says the «VLC не справляется» prompt is due (once; «Ждать» gives it another [LIMIT_MS]).
 * A new item or engine ([key]) starts the watch over.
 */
class VlcStartWatch(private val limitMs: Long = LIMIT_MS, private val progressMs: Long = PROGRESS_MS) {
    private var key: Any? = null
    private var startPos = -1L
    private var waited = 0L
    private var lastNow = -1L
    private var started = false
    private var asked = false

    /**
     * One tick. [vlcPlaying]: VLC is the engine and is meant to play (not paused, no error shown); [key]: the
     * engine instance and the item; [posMs] the engine position; [nowMs] a monotonic clock. True: show the prompt.
     */
    fun tick(vlcPlaying: Boolean, key: Any?, posMs: Long, nowMs: Long): Boolean {
        if (key != this.key) {
            this.key = key
            startPos = -1L
            waited = 0L
            lastNow = -1L
            started = false
            asked = false
        }
        val prev = lastNow
        lastNow = nowMs
        // the position moving is the start, also while the prompt is up (the prompt then goes away: [promptStale])
        if (startPos >= 0 && posMs - startPos >= progressMs) started = true
        if (!vlcPlaying || started || asked) return false
        if (startPos < 0) {
            startPos = posMs
            return false
        }
        if (posMs - startPos >= progressMs) {
            started = true
            return false
        }
        if (prev >= 0) waited += (nowMs - prev).coerceAtLeast(0L)
        if (waited < limitMs) return false
        asked = true
        return true
    }

    /** VLC got going: the watch is over. */
    val isStarted: Boolean get() = started

    /** An open «VLC не справляется» prompt has nothing to ask any more: the engine is not VLC or VLC got going. */
    fun promptStale(vlcEngine: Boolean): Boolean = !vlcEngine || started

    /** «Ждать»: another [limitMs] before asking again. */
    fun waitMore() {
        waited = 0L
        asked = false
    }

    companion object {
        const val LIMIT_MS = 20_000L
        const val PROGRESS_MS = 1_500L
    }
}
