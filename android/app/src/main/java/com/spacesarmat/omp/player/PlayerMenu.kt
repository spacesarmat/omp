package com.spacesarmat.omp.player

/** The rows of the player menu, in their order; pure, so that the order is testable without Android. */
enum class MenuRow { SWITCHER, EXTERNAL, AUDIO, SUBS, CHAPTERS, MARK_INTRO_START, MARK_INTRO_END, MARK_CREDITS }

object PlayerMenu {
    /** The player choice, "open in another player", the tracks, the chapters (when there are any) and the three marks. */
    fun rows(chapters: Int, external: Boolean = true): List<MenuRow> {
        val out = ArrayList<MenuRow>()
        out.add(MenuRow.SWITCHER)
        if (external) out.add(MenuRow.EXTERNAL)
        out.add(MenuRow.AUDIO)
        out.add(MenuRow.SUBS)
        if (chapters > 0) out.add(MenuRow.CHAPTERS)
        out.add(MenuRow.MARK_INTRO_START)
        out.add(MenuRow.MARK_INTRO_END)
        out.add(MenuRow.MARK_CREDITS)
        return out
    }
}
