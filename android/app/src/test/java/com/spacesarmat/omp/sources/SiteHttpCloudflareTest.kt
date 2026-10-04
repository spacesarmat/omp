package com.spacesarmat.omp.sources

import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class SiteHttpCloudflareTest {
    private lateinit var site: MockWebServer
    private lateinit var flare: MockWebServer
    private val events = ArrayList<String>()
    private val saved = HashMap<String, String>()
    private val jar = SiteCookieJar(object : CookieStore {
        override fun load(site: String): String? = saved[site]
        override fun save(site: String, data: String?) {
            if (data == null) saved.remove(site) else saved[site] = data
        }
    })

    /** The built-in check: answers [result]; a pass leaves a clearance cookie as the real one does. */
    private inner class FakeSolver(var result: CloudflareSolver.Result) : CloudflareSolving {
        override fun solve(url: HttpUrl): CloudflareSolver.Result {
            events.add("browser")
            if (result == CloudflareSolver.Result.SOLVED) {
                jar.saveFromResponse(url, listOf(Cookie.Builder().name("cf_clearance").value("from-browser").hostOnlyDomain(url.host).path("/").build()))
            }
            return result
        }
    }

    @Before
    fun setUp() {
        site = MockWebServer().apply { start() }
        flare = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() {
        site.shutdown()
        flare.shutdown()
    }

    private fun challenge(): MockResponse = MockResponse().setResponseCode(403)
        .addHeader("Server", "cloudflare").addHeader("cf-mitigated", "challenge")
        .setBody("<html><head><title>Just a moment...</title></head><body><script src=\"/cdn-cgi/challenge-platform/x\"></script></body></html>")

    private fun page(): MockResponse = MockResponse().setBody("<html><title>Трекер</title>результаты</html>")

    private fun http(solver: FakeSolver?): SiteHttp = SiteHttp(jar, CloudflarePass(solver, FlareSolverrClient(), jar))

    private fun get(h: SiteHttp, cf: SiteHttp.CloudflareOptions?): SiteHttp.Response =
        h.request(site.url("/browse.php?q=x").toString(), "GET", emptyMap(), null, null, null, 10_000, null, cf)

    private fun flareSolution(): String = JSONObject()
        .put("status", "ok")
        .put(
            "solution",
            JSONObject()
                .put("cookies", org.json.JSONArray().put(JSONObject().put("name", "cf_clearance").put("value", "from-flare").put("domain", site.url("/").host).put("path", "/")))
                .put("userAgent", "FlareAgent/1.0"),
        )
        .toString()

    private fun failure(block: () -> Unit): SiteHttpException {
        try {
            block()
        } catch (e: SiteHttpException) {
            return e
        }
        fail("expected a failure")
        throw IllegalStateException()
    }

    @Test
    fun withoutTheSwitchTheChallengeIsReturnedAsIs() {
        site.enqueue(challenge())
        val r = get(http(FakeSolver(CloudflareSolver.Result.SOLVED)), null)
        assertEquals(403, r.status)
        assertNull(r.cloudflare)
        assertTrue(events.isEmpty())
        assertEquals(1, site.requestCount)
    }

    @Test
    fun ordinaryPageNeedsNoCheck() {
        site.enqueue(page())
        val r = get(http(FakeSolver(CloudflareSolver.Result.SOLVED)), SiteHttp.CloudflareOptions(null))
        assertEquals(200, r.status)
        assertNull(r.cloudflare)
        assertTrue(events.isEmpty())
    }

    @Test
    fun builtInPassThenOneRetry() {
        site.enqueue(challenge())
        site.enqueue(page())
        val r = get(http(FakeSolver(CloudflareSolver.Result.SOLVED)), SiteHttp.CloudflareOptions(flare.url("/")))
        assertEquals(200, r.status)
        assertEquals("browser", r.cloudflare)
        assertEquals(listOf("browser"), events)
        // FlareSolverr is not asked when the built-in check passed
        assertEquals(0, flare.requestCount)
        site.takeRequest()
        val retry = site.takeRequest()
        assertEquals("/browse.php?q=x", retry.path)
        assertEquals("cf_clearance=from-browser", retry.getHeader("Cookie"))
        assertEquals(SiteHttp.USER_AGENT, retry.getHeader("User-Agent"))
    }

    @Test
    fun flareSolverrAfterTheBuiltInCheckAndItsUserAgentFromThenOn() {
        site.enqueue(challenge())
        site.enqueue(page())
        site.enqueue(page())
        flare.enqueue(MockResponse().setBody(flareSolution()))
        val h = http(FakeSolver(CloudflareSolver.Result.FAILED))
        val r = get(h, SiteHttp.CloudflareOptions(flare.url("/")))
        assertEquals("flaresolverr", r.cloudflare)
        assertEquals(listOf("browser"), events)
        assertEquals(1, flare.requestCount)
        // FlareSolverr fetched the site root, not the search
        assertEquals(site.url("/").toString(), JSONObject(flare.takeRequest().body.readUtf8()).getString("url"))
        val first = site.takeRequest()
        assertEquals(SiteHttp.USER_AGENT, first.getHeader("User-Agent"))
        val retry = site.takeRequest()
        assertEquals("FlareAgent/1.0", retry.getHeader("User-Agent"))
        assertEquals("cf_clearance=from-flare", retry.getHeader("Cookie"))
        // the next request to that host keeps FlareSolverr's User-Agent
        get(h, null)
        assertEquals("FlareAgent/1.0", site.takeRequest().getHeader("User-Agent"))
    }

    @Test
    fun interactiveWithoutFlareSolverr() {
        site.enqueue(challenge())
        val e = failure { get(http(FakeSolver(CloudflareSolver.Result.INTERACTIVE)), SiteHttp.CloudflareOptions(null)) }
        assertEquals(SiteHttp.CODE_CLOUDFLARE_INTERACTIVE, e.code)
        assertEquals(SiteHttp.CF_INTERACTIVE, e.reason)
        assertEquals(1, site.requestCount)
    }

    @Test
    fun interactiveStaysInteractiveWhenFlareSolverrFails() {
        site.enqueue(challenge())
        flare.enqueue(MockResponse().setBody("""{"status":"error","message":"timeout"}"""))
        val e = failure { get(http(FakeSolver(CloudflareSolver.Result.INTERACTIVE)), SiteHttp.CloudflareOptions(flare.url("/"))) }
        assertEquals(SiteHttp.CODE_CLOUDFLARE_INTERACTIVE, e.code)
        assertEquals(1, flare.requestCount)
    }

    @Test
    fun failedEverywhere() {
        site.enqueue(challenge())
        flare.enqueue(MockResponse().setResponseCode(500))
        val e = failure { get(http(FakeSolver(CloudflareSolver.Result.FAILED)), SiteHttp.CloudflareOptions(flare.url("/"))) }
        assertEquals(SiteHttp.CODE_CLOUDFLARE, e.code)
        assertTrue(e.reason.contains("Cloudflare"))
        // never an address or a cookie in what the page sees
        assertFalse(e.reason.contains("127.0.0.1") || e.reason.contains("localhost"))
    }

    @Test
    fun retryStillChallengedIsAFailureNotALoop() {
        site.enqueue(challenge())
        site.enqueue(challenge())
        site.enqueue(page())
        val e = failure { get(http(FakeSolver(CloudflareSolver.Result.SOLVED)), SiteHttp.CloudflareOptions(null)) }
        assertEquals(SiteHttp.CODE_CLOUDFLARE, e.code)
        assertEquals(2, site.requestCount)
        assertEquals(listOf("browser"), events)
    }

    @Test
    fun noSolverAvailable() {
        site.enqueue(challenge())
        val e = failure { get(SiteHttp(jar, CloudflarePass(null, FlareSolverrClient(), jar)), SiteHttp.CloudflareOptions(null)) }
        assertEquals(SiteHttp.CODE_CLOUDFLARE, e.code)
    }

    @Test
    fun specCarriesTheSwitchAndTheFlareSolverrAddress() {
        val on = HttpSpec.parse(JSONObject().put("url", "https://a.example/").put("cloudflare", true).put("flaresolverr", "http://192.168.1.5:8191"))
        assertTrue(on.cloudflare)
        assertEquals("http://192.168.1.5:8191", on.flareSolverr)
        val off = HttpSpec.parse(JSONObject().put("url", "https://a.example/").put("flaresolverr", "http://192.168.1.5:8191"))
        assertFalse(off.cloudflare)
        assertNull(off.flareSolverr)
        val bad = HttpSpec.parse(JSONObject().put("url", "https://a.example/").put("cloudflare", "yes").put("flaresolverr", "ftp://x"))
        assertFalse(bad.cloudflare)
        assertNull(HttpSpec.parse(JSONObject().put("url", "https://a.example/").put("cloudflare", true).put("flaresolverr", "ftp://x")).flareSolverr)
        assertEquals("browser", HttpSpec.reply(SiteHttp.Response(200, "https://a.example/", "", "browser")).getString("cloudflare"))
        assertFalse(HttpSpec.reply(SiteHttp.Response(200, "https://a.example/", "")).has("cloudflare"))
    }

    @Test
    fun userAgentIsOneConstant() {
        assertEquals(SiteHttp.USER_AGENT, CloudflarePass(null, FlareSolverrClient(), jar).userAgentFor("any.example"))
    }
}
