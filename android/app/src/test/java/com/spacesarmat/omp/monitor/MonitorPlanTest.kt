package com.spacesarmat.omp.monitor

import androidx.work.NetworkType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MonitorPlanTest {
    @Test
    fun hoursAreOneOfTheChoices() {
        assertEquals(1, MonitorPlan.hours(1))
        assertEquals(3, MonitorPlan.hours(3))
        assertEquals(6, MonitorPlan.hours(6))
        assertEquals(12, MonitorPlan.hours(12))
        assertEquals(3, MonitorPlan.hours(null))
        assertEquals(3, MonitorPlan.hours(0))
        assertEquals(3, MonitorPlan.hours(2))
        assertEquals(3, MonitorPlan.hours(24))
    }

    @Test
    fun scheduleDefaultsAreTheSpecDefaults() {
        assertEquals(MonitorSchedule(true, 3, true), MonitorPlan.schedule(null, null, null))
        assertEquals(MonitorSchedule(false, 12, false), MonitorPlan.schedule(false, 12, false))
        assertEquals(MonitorSchedule(true, 3, false), MonitorPlan.schedule(true, 5, false))
    }

    @Test
    fun wifiOnlyMeansUnmetered() {
        assertEquals(NetworkType.UNMETERED, MonitorPlan.network(true))
        assertEquals(NetworkType.CONNECTED, MonitorPlan.network(false))
    }

    @Test
    fun runLimitIsThreeMinutes() {
        assertEquals(180_000L, MonitorPlan.RUN_LIMIT_MS)
    }

    @Test
    fun itemIdsAreStableAndClearOfOtherIds() {
        val a = MonitorIds.item("sub:abc")
        assertEquals(a, MonitorIds.item("sub:abc"))
        assertNotEquals(a, MonitorIds.item("sub:abd"))
        for (id in listOf("sub:x", "ep:0123456789abcdef0123456789abcdef01234567", "", "ü")) {
            val n = MonitorIds.item(id)
            assertTrue(n >= 0x10000)
            assertTrue(n != MonitorIds.SUMMARY_SUBS && n != MonitorIds.SUMMARY_EPISODES && n != 8090)
        }
    }

    @Test
    fun channelNames() {
        assertEquals(MonitorIds.CHANNEL_SUBS, MonitorIds.channel("subs"))
        assertEquals(MonitorIds.CHANNEL_EPISODES, MonitorIds.channel("episodes"))
        assertEquals(MonitorIds.CHANNEL_BETTER, MonitorIds.channel("better"))
        assertNull(MonitorIds.channel("other"))
        assertNull(MonitorIds.channel(null))
    }

    @Test
    fun groupsAndSummariesPerChannel() {
        assertEquals(MonitorIds.GROUP_SUBS, MonitorIds.group(MonitorIds.CHANNEL_SUBS))
        assertEquals(MonitorIds.GROUP_EPISODES, MonitorIds.group(MonitorIds.CHANNEL_EPISODES))
        assertEquals(MonitorIds.GROUP_BETTER, MonitorIds.group(MonitorIds.CHANNEL_BETTER))
        assertEquals(MonitorIds.SUMMARY_BETTER, MonitorIds.summary(MonitorIds.CHANNEL_BETTER))
        assertEquals(3, MonitorIds.CHANNELS.map { MonitorIds.summary(it) }.toSet().size)
    }
}
