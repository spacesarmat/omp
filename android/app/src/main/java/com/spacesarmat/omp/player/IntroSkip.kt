package com.spacesarmat.omp.player

/** A skippable span of a queue item (ms). Today only the intro; the page sends one per item. */
data class Segment(val startMs: Long, val endMs: Long)

/**
 * «Пропустить заставку»: which queue item has an intro, whether the button is due at a position and which
 * intros the user dismissed. Pure (no Android), mirrors introChapter on LG: the button shows from the start of
 * the intro until 1 s before its end.
 */
class IntroSkip {
    private val intros = HashMap<Int, Segment>()
    private val dismissed = HashSet<Pair<Int, Long>>()

    /** The page's segment for [index] (a valid one only: finite, non-empty). */
    fun set(index: Int, startMs: Long, endMs: Long) {
        if (index < 0 || startMs < 0 || endMs <= startMs) return
        intros[index] = Segment(startMs, endMs)
    }

    fun clear() {
        intros.clear()
        dismissed.clear()
    }

    fun segment(index: Int): Segment? = intros[index]

    /** True when the button is due: inside [start, end - 1 s) of the item's intro and not dismissed. */
    fun due(index: Int, posMs: Long): Boolean {
        val s = intros[index] ?: return false
        return posMs >= s.startMs && posMs < s.endMs - END_GAP_MS && Pair(index, s.startMs) !in dismissed
    }

    /** Back: hides the button for this intro (a new intro start, i.e. another item or segment, shows it again). */
    fun dismiss(index: Int) {
        val s = intros[index] ?: return
        dismissed.add(Pair(index, s.startMs))
    }

    /** Where OK seeks to (the end of the intro), null when there is no intro. */
    fun target(index: Int): Long? = intros[index]?.endMs

    companion object {
        const val END_GAP_MS = 1000L
    }
}
