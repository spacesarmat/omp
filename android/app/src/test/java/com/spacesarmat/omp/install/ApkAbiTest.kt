package com.spacesarmat.omp.install

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApkAbiTest {
    private val rel = "https://github.com/spacesarmat/omp/releases/download/v0.15.0/"
    private val universal = ApkAbi.Apk(rel + "OMP-0.15.0.apk", "a".repeat(64), 900)
    private val arm64 = ApkAbi.Apk(rel + "OMP-0.15.0-arm64.apk", "b".repeat(64), 600)
    private val armv7 = ApkAbi.Apk(rel + "OMP-0.15.0-armv7.apk", "c".repeat(64), 300)
    private val both = mapOf(ApkAbi.ARM64 to arm64, ApkAbi.ARMV7 to armv7)

    @Test
    fun primaryAbiDecides() {
        assertEquals(ApkAbi.ARM64, ApkAbi.key(listOf("arm64-v8a", "armeabi-v7a", "armeabi")))
        // 64-bit CPU with a 32-bit system
        assertEquals(ApkAbi.ARMV7, ApkAbi.key(listOf("armeabi-v7a", "armeabi")))
        // x86 with ARM translation, unknown, empty → universal
        assertNull(ApkAbi.key(listOf("x86_64", "x86", "arm64-v8a")))
        assertNull(ApkAbi.key(listOf("armeabi")))
        assertNull(ApkAbi.key(emptyList()))
    }

    @Test
    fun choosesThePerAbiApkOrFallsBackToUniversal() {
        assertEquals(arm64, ApkAbi.choose(listOf("arm64-v8a", "armeabi-v7a"), universal, both))
        assertEquals(armv7, ApkAbi.choose(listOf("armeabi-v7a"), universal, both))
        assertEquals(universal, ApkAbi.choose(listOf("x86"), universal, both))
        assertEquals(universal, ApkAbi.choose(emptyList(), universal, both))
        // the feed has no entry for this ABI (an older feed has none at all)
        assertEquals(universal, ApkAbi.choose(listOf("armeabi-v7a"), universal, mapOf(ApkAbi.ARM64 to arm64)))
        assertEquals(universal, ApkAbi.choose(listOf("arm64-v8a"), universal, emptyMap()))
    }

    @Test
    fun parsesOnlyValidGithubEntries() {
        val o = JSONObject(
            """{"arm64":{"url":"${arm64.url}","sha256":"${arm64.sha256.uppercase()}","size":600},
               "armv7":{"url":"https://evil.example/omp.apk","sha256":"${armv7.sha256}","size":300},
               "x86":{"url":"${rel}x.apk","sha256":"${armv7.sha256}","size":1}}""",
        )
        assertEquals(mapOf(ApkAbi.ARM64 to arm64), ApkAbi.parseApks(o))
        assertTrue(ApkAbi.parseApks(JSONObject("""{"arm64":{"url":"${arm64.url}","sha256":"abc"}}""")).isEmpty())
        assertTrue(ApkAbi.parseApks(JSONObject("""{"arm64":"x","armv7":{"url":"http://github.com/a.apk","sha256":"${armv7.sha256}"}}""")).isEmpty())
        assertTrue(ApkAbi.parseApks(null).isEmpty())
        // a missing or negative size means «not published»
        assertEquals(0L, ApkAbi.parseApks(JSONObject("""{"armv7":{"url":"${armv7.url}","sha256":"${armv7.sha256}","size":-3}}"""))[ApkAbi.ARMV7]!!.size)
    }

    @Test
    fun parsesTheAbiList() {
        assertEquals(listOf("arm64-v8a", "armeabi-v7a", "armeabi"), ApkAbi.parseAbiList("arm64-v8a,armeabi-v7a,armeabi\n"))
        assertEquals(listOf("armeabi-v7a"), ApkAbi.parseAbiList("armeabi-v7a, x; rm -rf /,"))
        assertTrue(ApkAbi.parseAbiList("").isEmpty())
        assertTrue(ApkAbi.parseAbiList(null).isEmpty())
    }
}
