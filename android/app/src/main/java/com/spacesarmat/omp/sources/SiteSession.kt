package com.spacesarmat.omp.sources

import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject

/**
 * «Войти через браузер» (pure, JVM-tested): the person signs in to a site in a visible page themselves, OMP takes that
 * host's cookies as a session. Separate from the Cloudflare clearance import ([CloudflareCookies]): a session replaces
 * the site's earlier non-Cloudflare cookies (an old form login), keeps for [SESSION_TTL_MS] (the page does not say when
 * a cookie ends), and is capped at [MAX_COOKIES] cookies / [MAX_CHARS] characters. Values are never logged.
 */
object SiteSession {
    const val MAX_COOKIES = 30
    /** Sum of the names and values of one session. */
    const val MAX_CHARS = 6_000
    const val MAX_HOSTS = 10
    const val MAX_PATH = 200
    const val MAX_MARKER = 200
    const val SESSION_TTL_MS = 30L * 24 * 60 * 60 * 1000
    private val HOST = Regex("^[a-z0-9]([a-z0-9-]{0,62}\\.)+[a-z0-9-]{1,63}$")
    /** A path on the site: no scheme, no host, no spaces or control characters. */
    private val PATH = Regex("^[A-Za-z0-9._~!$&'()*+,;=:@%/?-]{0,$MAX_PATH}$")

    /** What says the page is a signed-in one. */
    class Check(
        /** The page asked to verify a session ('my.php', 'forum/index.php'), relative to the site root. */
        val path: String,
        /** Text that only a signed-in page has (its logout link). */
        val marker: String,
        /** The login page (a session that ends there is not one). */
        val loginPath: String,
        /** Cookie names a signed-in browser has (any of them); empty = any cookie of the site. */
        val cookies: List<String> = emptyList(),
    )

    fun validHost(host: String?): Boolean = host != null && host.length <= 253 && HOST.matches(host)

    fun validPath(path: String?): Boolean = path != null && !path.startsWith("/") && !path.startsWith("\\") && PATH.matches(path) && !path.contains("//")

    /** The page's check, null when a part is unusable. */
    fun check(path: String?, marker: String?, loginPath: String?, cookies: List<String>): Check? {
        if (!validPath(path) || !validPath(loginPath)) return null
        val m = marker?.takeIf { it.isNotEmpty() && it.length <= MAX_MARKER && it.none { c -> c.isISOControl() } } ?: return null
        val names = cookies.filter { CloudflareCookies.validName(it) }.take(MAX_COOKIES)
        return Check(path!!, m, loginPath!!, names)
    }

    /** The site's hosts as the page sends them: valid lowercase host names, at most [MAX_HOSTS]. */
    fun hosts(raw: List<String>): List<String> = raw.map { it.lowercase().trimEnd('.') }.filter { validHost(it) }.distinct().take(MAX_HOSTS)

    /** [host] is one of [hosts] or a subdomain of one (www.kinozal.tv, dl.kinozal.tv). */
    fun onSite(host: String?, hosts: Collection<String>): Boolean {
        val h = host?.lowercase()?.trimEnd('.') ?: return false
        if (h.isEmpty()) return false
        return hosts.any { h == it || h.endsWith(".$it") }
    }

    /** The cookies a session may hand over: valid, no duplicates, at most [MAX_COOKIES] and [MAX_CHARS] in all. */
    fun clean(pairs: List<Pair<String, String>>): List<Pair<String, String>> {
        val out = ArrayList<Pair<String, String>>()
        var chars = 0
        for (p in CloudflareCookies.clean(pairs)) {
            val n = p.first.length + p.second.length
            if (chars + n > MAX_CHARS) continue
            chars += n
            out.add(p)
            if (out.size >= MAX_COOKIES) break
        }
        return out
    }

    /** The browser looks signed in: one of the check's cookies, or (none named) any site cookie besides Cloudflare's. */
    fun ready(pairs: List<Pair<String, String>>, check: Check): Boolean =
        if (check.cookies.isEmpty()) pairs.any { !CloudflareCookies.isCloudflare(it.first) && it.second.isNotEmpty() }
        else pairs.any { it.first in check.cookies && it.second.isNotEmpty() }

    /** The answer of the check page is a signed-in one: 2xx, not the login page, the marker in it. */
    fun verified(status: Int, finalUrl: String, text: String, check: Check): Boolean {
        if (status < 200 || status >= 300) return false
        val path = finalUrl.toHttpUrlOrNull()?.encodedPath?.trimStart('/') ?: return false
        if (path.equals(check.loginPath.substringBefore('?'), ignoreCase = true)) return false
        return text.contains(check.marker)
    }

    /**
     * The session [pairs] into [jar] for [root]'s site: the site's earlier non-Cloudflare cookies go (a new session), the
     * site's cookies end at [now] + [SESSION_TTL_MS], Cloudflare's own at [now] + [CloudflareSolver.COPIED_TTL_MS].
     * Throws [IllegalArgumentException] when nothing usable is left.
     */
    fun import(jar: SiteCookieJar, root: HttpUrl, pairs: List<Pair<String, String>>, now: Long) {
        val clean = clean(pairs)
        val domain = SiteCookieJar.siteOf(root)
        val out = ArrayList<Cookie>()
        for ((name, value) in clean) {
            try {
                val until = now + if (CloudflareCookies.isCloudflare(name)) CloudflareSolver.COPIED_TTL_MS else SESSION_TTL_MS
                val b = Cookie.Builder().name(name).value(value).path("/").expiresAt(until)
                if (domain == root.host) b.hostOnlyDomain(domain) else b.domain(domain)
                if (root.isHttps) b.secure()
                out.add(b.build())
            } catch (e: IllegalArgumentException) {
                // a cookie OkHttp refuses is skipped
            }
        }
        require(out.any { !CloudflareCookies.isCloudflare(it.name) }) { "no session" }
        jar.replaceSite(root, { CloudflareCookies.isCloudflare(it.name) }, out)
    }

    /**
     * [import] with the User-Agent the session was made with ([ua], null = this device's: the host's session agent is
     * dropped). The agent is written first and dropped again when the cookies cannot be written: a session is never
     * kept without its User-Agent, nor reported kept when the encrypted storage refused it. Throws on any failure.
     */
    fun importWithAgent(jar: SiteCookieJar, agents: SessionAgents, root: HttpUrl, pairs: List<Pair<String, String>>, ua: String?, now: Long) {
        val site = CloudflareSolver.siteRoot(root)
        if (ua != null) agents.set(site.host, ua, now + SESSION_TTL_MS) else agents.clear(site.host)
        try {
            import(jar, site, pairs, now)
        } catch (e: Exception) {
            if (ua != null) agents.clear(site.host)
            throw e
        }
    }

    // ---- a staged session (the transfer from the phone, waiting for the TV's check) ----

    class Staged(val host: String, val cookies: List<Pair<String, String>>, val ua: String?) {
        override fun toString() = "Staged(${cookies.size} cookies)"
    }

    fun encode(s: Staged): String {
        val arr = JSONArray()
        for ((n, v) in s.cookies) arr.put(JSONObject().put("n", n).put("v", v))
        val o = JSONObject().put("host", s.host).put("cookies", arr)
        s.ua?.let { o.put("ua", it) }
        return o.toString()
    }

    fun decode(data: String?): Staged? {
        if (data.isNullOrEmpty()) return null
        return try {
            val o = JSONObject(data)
            val host = o.getString("host")
            if (!validHost(host)) return null
            val arr = o.getJSONArray("cookies")
            val pairs = ArrayList<Pair<String, String>>()
            for (i in 0 until arr.length()) {
                val c = arr.getJSONObject(i)
                pairs.add(c.getString("n") to c.getString("v"))
            }
            val clean = clean(pairs)
            if (clean.isEmpty()) return null
            val ua = (o.opt("ua") as? String)?.takeIf { validAgent(it) }
            Staged(host, clean, ua)
        } catch (e: Exception) {
            null
        }
    }

    private val UA = Regex("^[\\x20-\\x7e]{1,512}$")

    fun validAgent(ua: String?): Boolean = ua != null && UA.matches(ua)
}

/**
 * Where the visible login page may go (pure, JVM-tested). An allow-list, not a list of ads:
 *  - the site's own hosts exactly as the page sends them (every mirror: kinozal.me, kinozal.guru, kinozal.tv) and their
 *    www. form (www.kinozal.tv; a host sent as www.x also allows x). The login page, its form target and the check page
 *    are paths on those hosts, so a sign-in never needs another subdomain of the site;
 *  - Cloudflare's challenge pages and the captcha pages a login form may open in the main frame (hCaptcha and its
 *    subdomains, Google's reCAPTCHA under /recaptcha/ only).
 * Any other subdomain of the site is refused: NNM-Club's click-under ad sends the first tap on the page to
 * under.nnmclub.to/clicks/…, an empty ad page that left the sheet without a form. A /clicks/ path is refused on every
 * host, the site's own included. Nothing else, so the sheet never becomes a browser for another site.
 */
object LoginNavigation {
    private val CAPTCHA_HOSTS = setOf("challenges.cloudflare.com", "hcaptcha.com")
    private val RECAPTCHA_HOSTS = setOf("www.google.com", "google.com", "www.recaptcha.net", "recaptcha.net")
    private const val AD_PATH = "/clicks/"

    private fun clean(host: String?): String? = host?.lowercase()?.trimEnd('.')?.takeIf { it.isNotEmpty() }

    private fun bare(host: String): String = host.removePrefix("www.")

    private fun adPath(path: String?): Boolean = (path ?: "").startsWith(AD_PATH, ignoreCase = true)

    /** [host] is one of [siteHosts] or its www. form (no other subdomain). */
    fun siteHost(siteHosts: Collection<String>, host: String?): Boolean {
        val h = clean(host) ?: return false
        return siteHosts.any { s -> clean(s)?.let { bare(it) == bare(h) } == true }
    }

    /**
     * A request the login page gets an empty answer for (its frames and scripts, not only navigations): a /clicks/ path
     * on the site, or a subdomain of the site that is not one of its hosts (under.nnmclub.to). Other hosts (a CDN, the
     * captcha's scripts) load as usual.
     */
    fun ad(siteHosts: Collection<String>, host: String?, path: String?): Boolean {
        val h = clean(host) ?: return false
        if (!SiteSession.onSite(h, siteHosts)) return false
        return adPath(path) || !siteHost(siteHosts, h)
    }

    fun allowed(siteHosts: Collection<String>, host: String?, path: String?): Boolean {
        val h = clean(host) ?: return false
        if (adPath(path)) return false
        if (siteHost(siteHosts, h)) return true
        if (h in CAPTCHA_HOSTS || h.endsWith(".hcaptcha.com")) return true
        return h in RECAPTCHA_HOSTS && (path ?: "").startsWith("/recaptcha/")
    }
}

/** Cookies kept in memory only (the check of a session before it is stored). */
class MemoryCookieStore : CookieStore {
    private val sites = HashMap<String, String>()

    @Synchronized
    override fun load(site: String): String? = sites[site]

    @Synchronized
    override fun save(site: String, data: String?) {
        if (data == null) sites.remove(site) else sites[site] = data
    }
}

/**
 * Checks a session before OMP keeps it: the site's check page with only those cookies (a jar in memory) and the
 * User-Agent they were made with must be a signed-in one ([SiteSession.verified]). Blocking. Nothing is logged.
 */
class SessionVerifier(private val timeoutMs: Long = TIMEOUT_MS, private val now: () -> Long = System::currentTimeMillis) {
    fun verify(root: HttpUrl, pairs: List<Pair<String, String>>, ua: String, check: SiteSession.Check): Boolean {
        val site = CloudflareSolver.siteRoot(root)
        val jar = SiteCookieJar(MemoryCookieStore(), now)
        try {
            SiteSession.import(jar, site, pairs, now())
        } catch (e: IllegalArgumentException) {
            return false
        }
        val url = site.resolve(check.path) ?: return false
        if (url.host != site.host) return false
        return try {
            val r = SiteHttp(jar, null) { ua }.request(url.toString(), "GET", emptyMap(), null, null, null, timeoutMs)
            SiteSession.verified(r.status, r.url, r.text, check)
        } catch (e: Exception) {
            false
        }
    }

    companion object {
        const val TIMEOUT_MS = 15_000L
    }
}
