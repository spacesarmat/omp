package com.spacesarmat.omp.rpc

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RpcDispatcherTest {
    @Test
    fun replyIsCorrelated() {
        lateinit var d: RpcDispatcher
        d = RpcDispatcher({ msg ->
            val o = JSONObject(msg)
            Thread { d.onReply(o.getInt("rpc"), true, JSONObject().put("x", 1), null, null) }.start()
            true
        })
        val r = d.call("sources", JSONObject()) as RpcOutcome.Ok
        assertEquals(1, JSONObject(r.resultJson).getInt("x"))
    }

    @Test
    fun messageCarriesMethodAndParams() {
        var sent: JSONObject? = null
        RpcDispatcher({ msg -> sent = JSONObject(msg); true }, waitMs = 20).call("search", JSONObject().put("query", "q"))
        assertEquals("search", sent!!.getString("method"))
        assertEquals("q", sent!!.getJSONObject("params").getString("query"))
        assertTrue(sent!!.getInt("rpc") > 0)
    }

    @Test
    fun noPageIsNotReady() {
        assertEquals("not_ready", (RpcDispatcher({ false }).call("sources", JSONObject()) as RpcOutcome.Failed).code)
    }

    @Test
    fun silentPageTimesOut() {
        assertEquals("timeout", (RpcDispatcher({ true }, waitMs = 100).call("sources", JSONObject()) as RpcOutcome.Failed).code)
    }

    @Test
    fun failedReplyKeepsCodeAndMessage() {
        lateinit var d: RpcDispatcher
        d = RpcDispatcher({ msg ->
            d.onReply(JSONObject(msg).getInt("rpc"), false, null, "expired", "gone")
            true
        })
        val r = d.call("searchPoll", JSONObject()) as RpcOutcome.Failed
        assertEquals("expired", r.code)
        assertEquals("gone", r.message)
    }

    @Test
    fun stringResultIsQuotedJson() {
        lateinit var d: RpcDispatcher
        d = RpcDispatcher({ msg ->
            d.onReply(JSONObject(msg).getInt("rpc"), true, "magnet:?x\"y", null, null)
            true
        })
        val r = d.call("resolve", JSONObject()) as RpcOutcome.Ok
        assertEquals("magnet:?x\"y", JSONObject("{\"v\":" + r.resultJson + "}").getString("v"))
    }

    @Test
    fun failAllReleasesWaitersAndNinthCallIsNotReady() {
        val sent = CountDownLatch(8)
        val d = RpcDispatcher({ sent.countDown(); true }, waitMs = 10_000)
        val outcomes = java.util.Collections.synchronizedList(ArrayList<RpcOutcome>())
        val threads = (1..8).map { Thread { outcomes.add(d.call("search", JSONObject())) }.apply { start() } }
        assertTrue(sent.await(5, TimeUnit.SECONDS))
        assertEquals("not_ready", (d.call("search", JSONObject()) as RpcOutcome.Failed).code)
        d.failAll("not_ready")
        threads.forEach { it.join(5_000) }
        assertEquals(8, outcomes.size)
        assertTrue(outcomes.all { it is RpcOutcome.Failed && it.code == "not_ready" })
    }

    @Test
    fun lateReplyIsDropped() {
        var id = 0
        val d = RpcDispatcher({ msg -> id = JSONObject(msg).getInt("rpc"); true }, waitMs = 50)
        assertTrue(d.call("sources", JSONObject()) is RpcOutcome.Failed)
        d.onReply(id, true, JSONObject(), null, null) // no waiter any more: ignored
    }
}
