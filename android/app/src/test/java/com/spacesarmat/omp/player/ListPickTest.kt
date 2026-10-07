package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Test

/** The player's lists close on every pick, the current (checked) item included. */
class ListPickTest {
    private val log = ArrayList<String>()
    private fun pick(size: Int) = ListPick(size, { log.add("close") }, { log.add("pick $it") })

    @Test
    fun theCheckedItemClosesTheListToo() {
        // audio list with the 2nd track playing: choosing it again closes the list (and confirms it)
        pick(3).click(1)
        assertEquals(listOf("close", "pick 1"), log)
    }

    @Test
    fun anotherItemClosesThenApplies() {
        pick(3).click(2)
        assertEquals(listOf("close", "pick 2"), log)
    }

    @Test
    fun aSingleItemListClosesOnItsOnlyItem() {
        pick(1).click(0)
        assertEquals(listOf("close", "pick 0"), log)
    }

    @Test
    fun anOutOfRangePickOnlyCloses() {
        pick(2).click(5)
        pick(2).click(-1)
        assertEquals(listOf("close", "close"), log)
    }
}
