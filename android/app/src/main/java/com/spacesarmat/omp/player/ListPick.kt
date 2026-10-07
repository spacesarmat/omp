package com.spacesarmat.omp.player

/**
 * A pick in a player list with a current item (audio, subtitles, chapters): the list closes on every pick, the
 * current item included (before, choosing the checked row of an AlertDialog single-choice list left it open on some
 * boxes), then the pick is applied — also for the current item, so choosing the dub that plays confirms it for the
 * series («Озвучка»). Picks outside the list are ignored.
 */
class ListPick(private val size: Int, private val close: () -> Unit, private val apply: (Int) -> Unit) {
    fun click(n: Int) {
        close()
        if (n in 0 until size) apply(n)
    }
}
