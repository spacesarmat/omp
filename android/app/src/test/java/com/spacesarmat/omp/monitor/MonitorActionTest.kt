package com.spacesarmat.omp.monitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MonitorActionTest {
    private val add = MonitorAction(MonitorAction.ADD, "s1", "h:0123", 70000, MonitorIds.CHANNEL_SUBS, "Дюна 2160p")

    @Test
    fun roundTripsThroughJson() {
        assertEquals(add, MonitorAction.fromJson(add.toJson().toString()))
        val rep = MonitorAction(MonitorAction.REPLACE, "episodes", "abc:2:10", 70001, MonitorIds.CHANNEL_EPISODES, "")
        assertEquals(rep, MonitorAction.fromJson(rep.toJson().toString()))
        val better = MonitorAction(MonitorAction.REPLACE, "better", "abc:32", 70002, MonitorIds.CHANNEL_BETTER, "")
        assertEquals(better, MonitorAction.fromJson(better.toJson().toString()))
    }

    @Test
    fun thePageGetsNoAndroidIds() {
        val o = add.forPage()
        assertEquals(setOf("kind", "subId", "key"), o.keys().asSequence().toSet())
    }

    @Test
    fun rejectsMalformedActions() {
        assertNull(MonitorAction.fromJson(null))
        assertNull(MonitorAction.fromJson(""))
        assertNull(MonitorAction.fromJson("not json"))
        assertNull(MonitorAction.fromJson(add.toJson().put("kind", "delete").toString()))
        assertNull(MonitorAction.fromJson(add.toJson().put("subId", "").toString()))
        assertNull(MonitorAction.fromJson(add.toJson().put("key", "k".repeat(301)).toString()))
        assertNull(MonitorAction.fromJson(add.toJson().put("channel", "other").toString()))
        assertNull(MonitorAction.fromJson(add.toJson().apply { remove("notifId") }.toString()))
        assertNull(MonitorAction.fromJson(add.toJson().put("key", 5).toString()))
    }

    @Test
    fun longTitlesAreCut() {
        val a = MonitorAction.of(MonitorAction.ADD, "s", "k", 1, MonitorIds.CHANNEL_SUBS, "т".repeat(500))!!
        assertEquals(300, a.title.length)
    }

    @Test
    fun openLinks() {
        assertEquals("omp:news?sub=s1&finding=h%3A0123", MonitorLinks.open("s1", "h:0123", false))
        assertEquals("omp:news?sub=episodes&finding=abc%3A2%3A10&watch=1", MonitorLinks.open("episodes", "abc:2:10", true))
        val u = MonitorLinks.open("s 1", "t:дюна часть третья:12*", false)
        assertEquals(u, MonitorLinks.fromIntent(MonitorLinks.ACTION_OPEN, u))
    }

    @Test
    fun onlyOurIntentsOpenLinks() {
        val u = MonitorLinks.open("s1", "k", false)
        assertNull(MonitorLinks.fromIntent("android.intent.action.VIEW", u))
        assertNull(MonitorLinks.fromIntent(MonitorLinks.ACTION_OPEN, null))
        assertNull(MonitorLinks.fromIntent(MonitorLinks.ACTION_OPEN, "https://evil.example/"))
        assertNull(MonitorLinks.fromIntent(MonitorLinks.ACTION_OPEN, "omp:news?x=<script>"))
        assertNull(MonitorLinks.fromIntent(MonitorLinks.ACTION_OPEN, "omp:settings"))
        assertEquals("omp:news", MonitorLinks.fromIntent(MonitorLinks.ACTION_OPEN, "omp:news"))
    }
}
