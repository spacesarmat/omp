package com.spacesarmat.omp.monitor

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MonitorJournalTest {
    private fun seen(s: String, e: String) = JSONObject().put("s", s).put("e", e)
    private fun done(s: String, k: String, a: String) = JSONObject().put("s", s).put("k", k).put("a", a)

    @Test
    fun onlyTheLocalPageOriginIsServedFromTheBundle() {
        assertTrue(MonitorOrigin.isPage("http", "localhost", -1))
        assertTrue(MonitorOrigin.isPage("HTTP", "LocalHost", -1))
        // a TorrServer on this phone: the embedded one (LOCAL_URL) or one typed as localhost:<port>
        assertFalse(MonitorOrigin.isPage("http", "127.0.0.1", 8090))
        assertFalse(MonitorOrigin.isPage("http", "localhost", 8090))
        assertFalse(MonitorOrigin.isPage("http", "localhost", 80))
        assertFalse(MonitorOrigin.isPage("https", "localhost", -1))
        assertFalse(MonitorOrigin.isPage("http", "192.168.1.5", -1))
        assertFalse(MonitorOrigin.isPage(null, null, -1))
    }

    @Test
    fun markersAreValidated() {
        assertEquals(seen("s1", "h:01|t:x:5").toString(), MonitorJournal.item(seen("s1", "h:01|t:x:5")).toString())
        assertEquals(done("episodes", "a:1:10", "replace").toString(), MonitorJournal.item(done("episodes", "a:1:10", "replace")).toString())
        assertNull(MonitorJournal.item(done("s", "k", "delete")))
        assertNull(MonitorJournal.item(seen("", "e")))
        assertNull(MonitorJournal.item(seen("s", "")))
        assertNull(MonitorJournal.item(seen("s", "e".repeat(1001))))
        assertNull(MonitorJournal.item(JSONObject().put("s", "s")))
        assertNull(MonitorJournal.item("text"))
        // unknown fields are not stored
        assertEquals(setOf("s", "e"), MonitorJournal.item(seen("s", "e").put("password", "x"))!!.keys().asSequence().toSet())
    }

    @Test
    fun appendKeepsTheNewestAndMovesRepeats() {
        val a = MonitorJournal.append(emptyList(), JSONArray().put(seen("s", "1")).put(seen("s", "2")).put("junk"))
        assertEquals(listOf("1", "2"), a.map { it.getString("e") })
        val b = MonitorJournal.append(a, JSONArray().put(seen("s", "1")))
        assertEquals(listOf("2", "1"), b.map { it.getString("e") })
        var big: List<JSONObject> = emptyList()
        val add = JSONArray()
        for (i in 0 until MonitorJournal.MAX_ITEMS + 20) add.put(seen("s", "e$i"))
        big = MonitorJournal.append(big, add)
        assertEquals(MonitorJournal.MAX_ITEMS, big.size)
        assertEquals("e20", big.first().getString("e"))
        assertEquals(b.size, MonitorJournal.append(b, null).size)
    }

    @Test
    fun storedTextRoundTrips() {
        val items = listOf(seen("s", "1"), done("s", "k", "add"))
        assertEquals(items.map { it.toString() }, MonitorJournal.parse(MonitorJournal.toJson(items).toString()).map { it.toString() })
        assertEquals(emptyList<JSONObject>(), MonitorJournal.parse("{broken"))
        assertEquals(emptyList<JSONObject>(), MonitorJournal.parse(null))
    }

    @Test
    fun persistRequests() {
        val r = BridgeProtocol.parse(JSONObject().put("id", 3).put("op", "persist").put("items", JSONArray().put(seen("s", "1"))).toString())
        r as BridgeRequest.Persist
        assertEquals(1, r.items.length())
        assertTrue(BridgeProtocol.parse(JSONObject().put("id", 3).put("op", "persist").toString()) is BridgeRequest.Invalid)
        val tooMany = JSONArray()
        for (i in 0..MonitorJournal.MAX_ITEMS) tooMany.put(seen("s", "$i"))
        assertTrue(BridgeProtocol.parse(JSONObject().put("id", 3).put("op", "persist").put("items", tooMany).toString()) is BridgeRequest.Invalid)
    }
}
