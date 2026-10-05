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
    fun flareSolverrKeepsTheSiteLoginAndTakesOnlyCloudflareCookies() {
        val root = site.url("/")
        jar.saveFromResponse(root, listOf(Cookie.Builder().name("sid").value("login").hostOnlyDomain(root.host).path("/").expiresAt(System.currentTimeMillis() + 3_600_000).build()))
        site.enqueue(challenge())
        site.enqueue(page())
        flare.enqueue(
            MockResponse().setBody(
                JSONObject().put("status", "ok").put(
                    "solution",
                    JSONObject().put(
                        "cookies",
                        org.json.JSONArray()
                            .put(JSONObject().put("name", "cf_clearance").put("value", "from-flare").put("domain", root.host).put("path", "/"))
                            .put(JSONObject().put("name", "sid").put("value", "guest").put("domain", root.host).put("path", "/"))
                            .put(JSONObject().put("name", "other").put("value", "x").put("domain", root.host).put("path", "/")),
                    ).put("userAgent", "FlareAgent/1.0"),
                ).toString(),
            ),
        )
        val r = get(http(FakeSolver(CloudflareSolver.Result.FAILED)), SiteHttp.CloudflareOptions(flare.url("/")))
        assertEquals("flaresolverr", r.cloudflare)
        site.takeRequest()
        val cookie = site.takeRequest().getHeader("Cookie")!!
        assertTrue(cookie, cookie.contains("sid=login"))
        assertTrue(cookie, cookie.contains("cf_clearance=from-flare"))
        assertFalse(cookie, cookie.contains("guest") || cookie.contains("other"))
    }

    @Test
    fun flareSolverrIsSkippedForAHostWithABrowserSession() {
        val agents = SessionAgents(null)
        agents.set(site.url("/").host, "Phone-UA", System.currentTimeMillis() + 60_000)
        site.enqueue(challenge())
        flare.enqueue(MockResponse().setBody(flareSolution()))
        val h = SiteHttp(jar, CloudflarePass(FakeSolver(CloudflareSolver.Result.FAILED), FlareSolverrClient(), jar, { SiteHttp.USER_AGENT }, null, agents))
        failure { get(h, SiteHttp.CloudflareOptions(flare.url("/"))) }
        assertEquals(0, flare.requestCount)
        assertEquals("Phone-UA", site.takeRequest().getHeader("User-Agent"))
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

    private fun flareFor(host: String, until: Long? = null): String {
        val c = JSONObject().put("name", "cf_clearance").put("value", "from-flare").put("domain", host).put("path", "/")
        if (until != null) c.put("expires", until / 1000.0)
        return JSONObject().put("status", "ok")
            .put("solution", JSONObject().put("cookies", org.json.JSONArray().put(c)).put("userAgent", "FlareAgent/1.0"))
            .toString()
    }

    @Test
    fun theOverrideFollowsTheHostAfterARedirect() {
        val first = site.url("/").host
        val other = if (first == "localhost") "127.0.0.1" else "localhost"
        val moved = site.url("/browse.php?q=x").newBuilder().host(other).build()
        site.enqueue(MockResponse().setResponseCode(302).addHeader("Location", moved.toString()))
        site.enqueue(challenge())
        site.enqueue(MockResponse().setResponseCode(302).addHeader("Location", moved.toString()))
        site.enqueue(page())
        flare.enqueue(MockResponse().setBody(flareFor(other)))
        val r = get(http(FakeSolver(CloudflareSolver.Result.FAILED)), SiteHttp.CloudflareOptions(flare.url("/")))
        assertEquals("flaresolverr", r.cloudflare)
        val uas = (1..4).map { site.takeRequest().getHeader("User-Agent") }
        // the first host keeps the default; the challenged host (after the redirect) gets FlareSolverr's on the retry
        assertEquals(listOf(SiteHttp.USER_AGENT, SiteHttp.USER_AGENT, SiteHttp.USER_AGENT, "FlareAgent/1.0"), uas)
    }

    @Test
    fun oneFlareSolverrCallPerHost() {
        flare.enqueue(MockResponse().setBody(flareSolution()).setBodyDelay(400, java.util.concurrent.TimeUnit.MILLISECONDS))
        val pass = CloudflarePass(FakeSolver(CloudflareSolver.Result.FAILED), FlareSolverrClient(), jar)
        val url = site.url("/x")
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val a = pool.submit<CloudflarePass.Outcome> { pass.pass(url, flare.url("/")) }
            Thread.sleep(100)
            val b = pool.submit<CloudflarePass.Outcome> { pass.pass(url, flare.url("/")) }
            assertEquals(CloudflarePass.Outcome.FLARESOLVERR, a.get(10, java.util.concurrent.TimeUnit.SECONDS))
            assertEquals(CloudflarePass.Outcome.FLARESOLVERR, b.get(10, java.util.concurrent.TimeUnit.SECONDS))
        } finally {
            pool.shutdownNow()
        }
        assertEquals(1, flare.requestCount)
    }

    @Test
    fun overridesAreKeptAcrossRestartsUntilTheClearanceEnds() {
        var stored: String? = null
        val store = object : AgentStore {
            override fun load(): String? = stored
            override fun save(data: String?) {
                stored = data
            }
        }
        var now = 1_000_000_000_000L
        val host = site.url("/").host
        flare.enqueue(MockResponse().setBody(flareFor(host, now + 3_600_000)))
        val pass = CloudflarePass(FakeSolver(CloudflareSolver.Result.FAILED), FlareSolverrClient(), jar, { "Device/1" }, store) { now }
        assertEquals("Device/1", pass.userAgentFor(host))
        assertEquals(CloudflarePass.Outcome.FLARESOLVERR, pass.pass(site.url("/"), flare.url("/")))
        assertEquals("FlareAgent/1.0", pass.userAgentFor(host))
        // never a cookie in the stored overrides
        assertFalse(stored!!.contains("from-flare"))
        // after a restart
        val again = CloudflarePass(null, FlareSolverrClient(), jar, { "Device/1" }, store) { now }
        assertEquals("FlareAgent/1.0", again.userAgentFor(host.uppercase()))
        // the clearance ended: the default again, and it is dropped from the storage
        now += 3_600_001
        assertEquals("Device/1", again.userAgentFor(host))
        assertNull(stored)
    }

    @Test
    fun builtInPassDropsTheOverride() {
        var stored: String? = null
        val store = object : AgentStore {
            override fun load(): String? = stored
            override fun save(data: String?) {
                stored = data
            }
        }
        val solver = FakeSolver(CloudflareSolver.Result.FAILED)
        val host = site.url("/").host
        flare.enqueue(MockResponse().setBody(flareFor(host)))
        val pass = CloudflarePass(solver, FlareSolverrClient(), jar, { "Device/1" }, store)
        pass.pass(site.url("/"), flare.url("/"))
        assertEquals("FlareAgent/1.0", pass.userAgentFor(host))
        solver.result = CloudflareSolver.Result.SOLVED
        assertEquals(CloudflarePass.Outcome.BROWSER, pass.pass(site.url("/"), flare.url("/")))
        assertEquals("Device/1", pass.userAgentFor(host))
    }

    @Test
    fun theDeviceUserAgentGoesWithEveryRequest() {
        site.enqueue(page())
        val pass = CloudflarePass(null, FlareSolverrClient(), jar, { "Device/1" })
        SiteHttp(jar, pass) { "Device/1" }.request(site.url("/").toString(), "GET", emptyMap(), null, null, null, 5_000)
        assertEquals("Device/1", site.takeRequest().getHeader("User-Agent"))
        site.enqueue(page())
        // a page-set one wins
        SiteHttp(jar, pass) { "Device/1" }.request(site.url("/").toString(), "GET", mapOf("User-Agent" to "Own/2"), null, null, null, 5_000)
        assertEquals("Own/2", site.takeRequest().getHeader("User-Agent"))
    }

    @Test
    fun userAgentIsOneConstant() {
        assertEquals(SiteHttp.USER_AGENT, CloudflarePass(null, FlareSolverrClient(), jar).userAgentFor("any.example"))
    }
}
