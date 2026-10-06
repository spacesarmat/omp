package com.spacesarmat.omp.rpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

internal class MapPrefs : RpcPrefs {
    val m = HashMap<String, Any?>()
    override fun getInt(k: String) = m[k] as? Int
    override fun getString(k: String) = m[k] as? String
    override fun getBool(k: String) = m[k] as? Boolean
    override fun put(k: String, v: Any?) {
        if (v == null) m.remove(k) else m[k] = v
    }
}

class RpcConfigTest {
    @Test
    fun tokenIsPersistent() {
        val p = MapPrefs()
        val a = RpcConfig(p).token()
        assertTrue(RpcConfig.TOKEN.matches(a))
        assertEquals(a, RpcConfig(p).token())
    }

    @Test
    fun disablingRevokesToken() {
        val p = MapPrefs()
        val c = RpcConfig(p)
        val a = c.token()
        c.setEnabled(false)
        assertFalse(c.enabled)
        c.setEnabled(true)
        assertTrue(c.enabled)
        assertNotEquals(a, c.token())
    }

    @Test
    fun enabledIsFalseWhenNeverSet() {
        assertFalse(RpcConfig(MapPrefs()).enabled)
    }

    @Test
    fun portDefaultsAndPersists() {
        val p = MapPrefs()
        assertEquals(8097, RpcConfig(p).port())
        RpcConfig(p).savePort(40123)
        assertEquals(40123, RpcConfig(p).port())
    }

    @Test
    fun malformedStoredValuesAreReplaced() {
        val p = MapPrefs()
        p.m["token"] = "not-a-token"
        p.m["port"] = 70000
        val c = RpcConfig(p)
        assertTrue(RpcConfig.TOKEN.matches(c.token()))
        assertEquals(8097, c.port())
    }
}
