package com.spacesarmat.omp.rpc

import com.spacesarmat.omp.monitor.BridgeRequest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class RpcProtocolTest {
    @Test fun ready() { assertSame(RpcPageMessage.Ready, RpcProtocol.parse("""{"op":"ready"}""")) }

    @Test fun reply() {
        val r = RpcProtocol.parse("""{"op":"rpcReply","rpc":7,"ok":true,"result":{"a":1}}""") as RpcPageMessage.Reply
        assertEquals(7, r.rpc)
        assertTrue(r.ok)
        assertEquals(1, (r.result as JSONObject).getInt("a"))
    }

    @Test fun errorReply() {
        val r = RpcProtocol.parse("""{"op":"rpcReply","rpc":7,"ok":false,"error":{"code":"expired"}}""") as RpcPageMessage.Reply
        assertEquals("expired", r.code)
        assertFalse(r.ok)
        assertNull(r.message)
        val bare = RpcProtocol.parse("""{"op":"rpcReply","rpc":8,"ok":false}""") as RpcPageMessage.Reply
        assertEquals("failed", bare.code)
    }

    @Test fun malformedReplyIsInvalid() {
        assertTrue(RpcProtocol.parse("""{"op":"rpcReply","ok":true}""") is RpcPageMessage.Invalid)
        assertTrue(RpcProtocol.parse("""{"op":"rpcReply","rpc":"7","ok":true}""") is RpcPageMessage.Invalid)
        assertTrue(RpcProtocol.parse("""{"op":"rpcReply","rpc":7}""") is RpcPageMessage.Invalid)
    }

    @Test fun httpGoesToBridge() {
        val m = RpcProtocol.parse("""{"id":1,"op":"http","request":{"url":"https://rutor.info/","method":"GET"}}""")
        assertTrue(m is RpcPageMessage.Bridge)
        assertTrue((m as RpcPageMessage.Bridge).request is BridgeRequest.Http)
    }

    @Test fun badHttpKeepsItsId() {
        val m = RpcProtocol.parse("""{"id":4,"op":"http","request":{"url":"file:///etc/hosts","method":"GET"}}""")
        assertEquals(4, (m as RpcPageMessage.Invalid).id)
    }

    @Test fun monitorOpsRefused() {
        listOf("start", "notify", "persist", "finish").forEach {
            assertTrue(it, RpcProtocol.parse("""{"id":1,"op":"$it"}""") is RpcPageMessage.Invalid)
        }
        assertTrue(RpcProtocol.parse("""{"op":"finish","summary":{}}""") is RpcPageMessage.Invalid)
    }

    @Test fun oversized() { assertTrue(RpcProtocol.parse("x".repeat(RpcProtocol.MAX_MESSAGE + 1)) is RpcPageMessage.Invalid) }

    @Test fun garbage() {
        assertTrue(RpcProtocol.parse(null) is RpcPageMessage.Invalid)
        assertTrue(RpcProtocol.parse("not json") is RpcPageMessage.Invalid)
    }

    @Test fun requestShape() {
        val o = JSONObject(RpcProtocol.request(3, "sources", JSONObject()))
        assertEquals(3, o.getInt("rpc"))
        assertEquals("sources", o.getString("method"))
        assertEquals(0, o.getJSONObject("params").length())
    }
}
