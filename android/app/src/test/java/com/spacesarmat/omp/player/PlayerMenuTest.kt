package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayerMenuTest {
    @Test
    fun theExternalRowFollowsThePlayerChoice() {
        assertEquals(
            listOf(
                MenuRow.SWITCHER, MenuRow.EXTERNAL, MenuRow.AUDIO, MenuRow.SUBS,
                MenuRow.MARK_INTRO_START, MenuRow.MARK_INTRO_END, MenuRow.MARK_CREDITS,
            ),
            PlayerMenu.rows(0),
        )
    }

    @Test
    fun chaptersComeAfterTheTracksWhenTheFileHasThem() {
        val rows = PlayerMenu.rows(3)
        assertEquals(MenuRow.CHAPTERS, rows[4])
        assertEquals(8, rows.size)
    }

    @Test
    fun withoutTheExternalRowTheOldOrderIsKept() {
        assertEquals(
            listOf(
                MenuRow.SWITCHER, MenuRow.AUDIO, MenuRow.SUBS, MenuRow.CHAPTERS,
                MenuRow.MARK_INTRO_START, MenuRow.MARK_INTRO_END, MenuRow.MARK_CREDITS,
            ),
            PlayerMenu.rows(1, external = false),
        )
    }
}
