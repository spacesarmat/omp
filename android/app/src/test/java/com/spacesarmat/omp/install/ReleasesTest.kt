package com.spacesarmat.omp.install

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ReleasesTest {
    private val ipk = ByteArray(5000) { (it % 251).toByte() }
    private val ipkUrl = "https://github.com/spacesarmat/omp/releases/download/v0.14.0/OMP-0.14.0-webOS.ipk"

    private fun feed(url: String = ipkUrl, hash: String = sha256(ipk), size: Long = ipk.size.toLong(), version: String = "0.14.0") =
        """{"version":"$version","ipkUrl":"$url","ipkHash":"$hash","ipkSize":$size,"notes":[]}"""

    private fun code(block: () -> Unit): String {
        try {
            block()
        } catch (e: InstallFailure) {
            return e.code
        }
        fail("no failure")
        return ""
    }

    @Test
    fun hostAllowlistIsHttpsGithubOnly() {
        assertTrue(ReleaseHosts.allowed("https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/update.json"))
        assertTrue(ReleaseHosts.allowed(ipkUrl))
        assertTrue(ReleaseHosts.allowed("https://release-assets.githubusercontent.com/github-production-release-asset/1/x?sig=1"))
        assertTrue(ReleaseHosts.allowed("https://objects.githubusercontent.com/x"))
        assertTrue(ReleaseHosts.allowed("https://api.github.com/repos/a/b/releases/latest"))
        assertFalse(ReleaseHosts.allowed("http://github.com/a"))
        assertFalse(ReleaseHosts.allowed("https://github.com.evil.example/a"))
        assertFalse(ReleaseHosts.allowed("https://evil.example/github.com"))
        assertFalse(ReleaseHosts.allowed("https://github.com:8443/a"))
        assertFalse(ReleaseHosts.allowed("ftp://github.com/a"))
        assertFalse(ReleaseHosts.allowed(null))
        assertFalse(ReleaseHosts.allowed("not a url"))
    }

    @Test
    fun parsesTheUpdateFeed() {
        val p = Releases.parseFeed(feed(hash = sha256(ipk).uppercase()), Item.OMP, "omp.ipk")
        assertEquals("0.14.0", p.version)
        assertEquals(ipkUrl, p.url)
        assertEquals(sha256(ipk), p.sha256)
        assertEquals(5000L, p.size)
        assertEquals("omp.ipk", p.fileName)
    }

    @Test
    fun picksThePerAbiApkFromTheAndroidFeed() {
        val rel = "https://github.com/spacesarmat/omp/releases/download/v0.15.0/"
        val uni = rel + "OMP-0.15.0.apk"
        val json = """{"version":"0.15.0","ipkUrl":"$uni","ipkHash":"${"a".repeat(64)}","ipkSize":900,
            "apks":{"arm64":{"url":"${rel}OMP-0.15.0-arm64.apk","sha256":"${"b".repeat(64)}","size":600},
                    "armv7":{"url":"${rel}OMP-0.15.0-armv7.apk","sha256":"${"c".repeat(64)}","size":300}}}"""
        val arm = Releases.parseFeed(json, Item.OMP, "omp.apk", listOf("armeabi-v7a", "armeabi"))
        assertEquals(rel + "OMP-0.15.0-armv7.apk", arm.url)
        assertEquals("c".repeat(64), arm.sha256)
        assertEquals(300L, arm.size)
        assertEquals("0.15.0", arm.version)
        assertEquals(rel + "OMP-0.15.0-arm64.apk", Releases.parseFeed(json, Item.OMP, "omp.apk", listOf("arm64-v8a")).url)
        // no ABI known, or an x86 box: the universal APK
        assertEquals(uni, Releases.parseFeed(json, Item.OMP, "omp.apk").url)
        assertEquals(uni, Releases.parseFeed(json, Item.OMP, "omp.apk", listOf("x86_64")).url)
        // a 0.14-style feed without apks still works
        assertEquals(ipkUrl, Releases.parseFeed(feed(), Item.OMP, "omp.apk", listOf("arm64-v8a")).url)
        // the universal entry stays mandatory (older clients need it)
        val noUniversal = json.replace("\"ipkUrl\":\"$uni\",", "")
        assertEquals(InstallCodes.RELEASE, code { Releases.parseFeed(noUniversal, Item.OMP, "omp.apk", listOf("arm64-v8a")) })
    }

    @Test
    fun rejectsFeedsWithForeignHostsOrNoChecksum() {
        assertEquals(InstallCodes.RELEASE, code { Releases.parseFeed(feed(url = "https://evil.example/omp.ipk"), Item.OMP, "omp.ipk") })
        assertEquals(InstallCodes.RELEASE, code { Releases.parseFeed(feed(url = "http://github.com/omp.ipk"), Item.OMP, "omp.ipk") })
        assertEquals(InstallCodes.RELEASE, code { Releases.parseFeed(feed(hash = "abc"), Item.OMP, "omp.ipk") })
        assertEquals(InstallCodes.RELEASE, code { Releases.parseFeed(feed(version = "latest"), Item.OMP, "omp.ipk") })
        assertEquals(InstallCodes.RELEASE, code { Releases.parseFeed("<html>", Item.OMP, "omp.ipk") })
    }

    @Test
    fun readsTheHomebrewChannelRelease() {
        val digest = "a".repeat(64)
        val json = """{"tag_name":"v0.7.3","assets":[
            {"name":"org.webosbrew.hbchannel.manifest.json","size":461,"browser_download_url":"https://github.com/webosbrew/webos-homebrew-channel/releases/download/v0.7.3/org.webosbrew.hbchannel.manifest.json"},
            {"name":"org.webosbrew.hbchannel_0.7.3_all.ipk","size":1699858,"digest":"sha256:$digest","browser_download_url":"https://github.com/webosbrew/webos-homebrew-channel/releases/download/v0.7.3/org.webosbrew.hbchannel_0.7.3_all.ipk"}]}"""
        val r = Releases.parseHbcRelease(json)
        assertEquals("0.7.3", r.version)
        assertEquals(1699858L, r.size)
        assertEquals(digest, r.digest)
        assertTrue(r.manifestUrl!!.endsWith(".manifest.json"))
        assertEquals(digest, Releases.parseHbcManifest("""{"ipkHash":{"sha256":"${digest.uppercase()}"}}"""))
        assertNull(Releases.parseHbcManifest("""{"ipkHash":{}}"""))
    }

    @Test
    fun homebrewChannelAssetsOutsideGithubAreIgnored() {
        val json = """{"tag_name":"v1","assets":[{"name":"x.ipk","size":10,"browser_download_url":"https://evil.example/x.ipk"}]}"""
        assertEquals(InstallCodes.RELEASE, code { Releases.parseHbcRelease(json) })
    }

    @Test
    fun homebrewChannelChecksumRules() {
        val a = "a".repeat(64)
        val b = "b".repeat(64)
        assertEquals(a, Releases.hbcHash(a, a))
        assertEquals(a, Releases.hbcHash(a, null))
        assertEquals(b, Releases.hbcHash(null, b))
        assertEquals(InstallCodes.CHECKSUM, code { Releases.hbcHash(a, b) })
        assertEquals(InstallCodes.RELEASE, code { Releases.hbcHash(null, null) })
    }

    @Test
    fun homebrewChannelUsesManifestAndDigest() {
        val hbc = ByteArray(300) { 7 }
        val sha = sha256(hbc)
        val base = "https://github.com/webosbrew/webos-homebrew-channel/releases/download/v0.7.3/"
        val api = """{"tag_name":"v0.7.3","assets":[
            {"name":"org.webosbrew.hbchannel.manifest.json","size":1,"browser_download_url":"${base}org.webosbrew.hbchannel.manifest.json"},
            {"name":"org.webosbrew.hbchannel_0.7.3_all.ipk","size":300,"digest":"sha256:$sha","browser_download_url":"${base}org.webosbrew.hbchannel_0.7.3_all.ipk"}]}"""
        val http = FakeHttp(
            mapOf(
                Releases.HBC_LATEST to api.toByteArray(),
                "${base}org.webosbrew.hbchannel.manifest.json" to """{"ipkHash":{"sha256":"$sha"}}""".toByteArray(),
            ),
        )
        val p = Releases(http).homebrewChannel(CancelToken())
        assertEquals(sha, p.sha256)
        assertEquals(300L, p.size)
        assertEquals(Item.HBC, p.item)
    }

    @Test
    fun downloadsAndVerifies() {
        val dir = tempDir()
        val http = FakeHttp(mapOf(ipkUrl to ipk))
        val pkg = Releases.parseFeed(feed(), Item.OMP, "omp.ipk")
        val percents = ArrayList<Int>()
        var verified = false
        val f = ReleaseDownloader(http, dir).fetch(pkg, 1_000_000, CancelToken(), { percents.add(it) }, { verified = true })
        assertTrue(f.exists())
        assertEquals(sha256(ipk), sha256(f.readBytes()))
        assertEquals(0, percents.first())
        assertEquals(100, percents.last())
        assertTrue(verified)
        assertEquals(listOf("omp.ipk"), dir.list()!!.toList())
        f.delete()
    }

    @Test
    fun checksumMismatchLeavesNothing() {
        val dir = tempDir()
        val pkg = Releases.parseFeed(feed(hash = "0".repeat(64)), Item.OMP, "omp.ipk")
        assertEquals(InstallCodes.CHECKSUM, code { ReleaseDownloader(FakeHttp(mapOf(ipkUrl to ipk)), dir).fetch(pkg, 1_000_000, CancelToken(), {}) })
        assertEquals(0, dir.list()!!.size)
    }

    @Test
    fun sizeMismatchFails() {
        val dir = tempDir()
        val smaller = Releases.parseFeed(feed(size = 4000), Item.OMP, "omp.ipk")
        assertEquals(InstallCodes.TOO_BIG, code { ReleaseDownloader(FakeHttp(mapOf(ipkUrl to ipk)), dir).fetch(smaller, 1_000_000, CancelToken(), {}) })
        val bigger = Releases.parseFeed(feed(size = 6000), Item.OMP, "omp.ipk")
        assertEquals(InstallCodes.CHECKSUM, code { ReleaseDownloader(FakeHttp(mapOf(ipkUrl to ipk), lengthOverride = -1), dir).fetch(bigger, 1_000_000, CancelToken(), {}) })
        assertEquals(0, dir.list()!!.size)
    }

    @Test
    fun capIsEnforcedWithoutAPublishedSize() {
        val dir = tempDir()
        val pkg = Releases.parseFeed(feed(size = 0), Item.OMP, "omp.ipk")
        assertEquals(InstallCodes.TOO_BIG, code { ReleaseDownloader(FakeHttp(mapOf(ipkUrl to ipk), lengthOverride = -1), dir).fetch(pkg, 1000, CancelToken(), {}) })
        assertEquals(InstallCodes.TOO_BIG, code { ReleaseDownloader(FakeHttp(mapOf(ipkUrl to ipk)), dir).fetch(pkg, 1000, CancelToken(), {}) })
        assertEquals(0, dir.list()!!.size)
    }

    @Test
    fun cancelDeletesThePartialFile() {
        val dir = tempDir()
        val cancel = CancelToken()
        val http = FakeHttp(mapOf(ipkUrl to ipk))
        http.onStream = { cancel.cancel() }
        val pkg = Releases.parseFeed(feed(), Item.OMP, "omp.ipk")
        assertEquals(InstallCodes.CANCELLED, code { ReleaseDownloader(http, dir).fetch(pkg, 1_000_000, cancel, {}) })
        assertEquals(0, dir.list()!!.size)
    }

    @Test
    fun feedsComeFromGhPages() {
        val http = FakeHttp(mapOf(Releases.FEED_ANDROID to feed(url = "https://github.com/spacesarmat/omp/releases/download/v0.14.0/OMP-0.14.0.apk").toByteArray()))
        val p = Releases(http) { 42 }.ompAndroid(CancelToken())
        assertEquals("omp.apk", p.fileName)
        assertEquals(Releases.FEED_ANDROID + "?t=42", http.requested.single())
    }
}
