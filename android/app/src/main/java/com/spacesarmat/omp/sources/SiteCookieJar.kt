package com.spacesarmat.omp.sources

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject

/** Persistent cookies of one site (encrypted on the device, see [SecretStorage]). */
interface CookieStore {
    /** Throws when the storage is temporarily unreadable. */
    fun load(site: String): String?

    /** null removes the site. */
    fun save(site: String, data: String?)

    /** [save] that throws when the data could not be written (a browser session must not live in memory only). */
    fun saveStrict(site: String, data: String?) = save(site, data)
}

/**
 * Cookies per site (registrable domain, e.g. rutracker.org), kept in memory and saved through [CookieStore]
 * so a tracker session survives restarts. A site's cookies are only sent to URLs they match.
 */
class SiteCookieJar(private val store: CookieStore, private val now: () -> Long = System::currentTimeMillis) : CookieJar {
    private val sites = HashMap<String, MutableList<Cookie>>()
    // sites whose stored cookies could not be read: kept in memory only, so the stored session is not overwritten
    private val unreadable = HashSet<String>()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val site = siteOf(url)
        val list = cookiesOf(site)
        val t = now()
        for (c in cookies) {
            list.removeAll { it.name == c.name && it.domain == c.domain && it.path == c.path }
            if (c.expiresAt > t) list.add(c)
        }
        persist(site, list)
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val site = siteOf(url)
        val list = cookiesOf(site)
        val t = now()
        if (list.removeAll { it.expiresAt <= t }) persist(site, list)
        return list.filter { it.matches(url) }
    }

    /**
     * A new session of the site of [url]: its cookies that [keep] refuses go, then [cookies] are added (a browser
     * sign-in replaces an older form login; Cloudflare's clearance stays). Strict: the result is written first
     * ([CookieStore.saveStrict]) and only then taken in memory; throws (and changes nothing) when it cannot be written.
     */
    @Synchronized
    fun replaceSite(url: HttpUrl, keep: (Cookie) -> Boolean, cookies: List<Cookie>) {
        val site = siteOf(url)
        val list = cookiesOf(site)
        if (site in unreadable) throw IllegalStateException("stored cookies unreadable")
        val t = now()
        val next = ArrayList(list)
        next.removeAll { !keep(it) || it.expiresAt <= t }
        for (c in cookies) {
            next.removeAll { it.name == c.name && it.domain == c.domain && it.path == c.path }
            if (c.expiresAt > t) next.add(c)
        }
        store.saveStrict(site, if (next.isEmpty()) null else CookieCodec.encode(next))
        list.clear()
        list.addAll(next)
    }

    /** Forgets every cookie of the site of [url] (logout). */
    @Synchronized
    fun clear(url: HttpUrl) {
        val site = siteOf(url)
        sites[site] = mutableListOf()
        unreadable.remove(site)
        store.save(site, null)
    }

    private fun cookiesOf(site: String): MutableList<Cookie> =
        sites.getOrPut(site) {
            val t = now()
            val data = try {
                store.load(site)
            } catch (e: Exception) {
                unreadable.add(site)
                null
            }
            CookieCodec.decode(data).filter { it.expiresAt > t }.toMutableList()
        }

    private fun persist(site: String, list: List<Cookie>) {
        if (site in unreadable) return
        store.save(site, if (list.isEmpty()) null else CookieCodec.encode(list))
    }

    companion object {
        fun siteOf(url: HttpUrl): String = url.topPrivateDomain() ?: url.host
    }
}

/** Cookies ⇄ JSON. Session (non-persistent) cookies are kept too: a tracker login must survive restarts. */
object CookieCodec {
    fun encode(cookies: List<Cookie>): String {
        val arr = JSONArray()
        for (c in cookies) {
            val o = JSONObject()
                .put("n", c.name)
                .put("v", c.value)
                .put("d", c.domain)
                .put("p", c.path)
            if (c.persistent) o.put("e", c.expiresAt)
            if (c.secure) o.put("s", true)
            if (c.httpOnly) o.put("h", true)
            if (c.hostOnly) o.put("o", true)
            arr.put(o)
        }
        return arr.toString()
    }

    fun decode(data: String?): List<Cookie> {
        if (data.isNullOrEmpty()) return emptyList()
        val arr = try {
            JSONArray(data)
        } catch (e: Exception) {
            return emptyList()
        }
        val out = ArrayList<Cookie>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            try {
                val b = Cookie.Builder()
                    .name(o.getString("n"))
                    .value(o.getString("v"))
                    .path(o.getString("p"))
                val domain = o.getString("d")
                if (o.optBoolean("o")) b.hostOnlyDomain(domain) else b.domain(domain)
                if (o.has("e")) b.expiresAt(o.getLong("e"))
                if (o.optBoolean("s")) b.secure()
                if (o.optBoolean("h")) b.httpOnly()
                out.add(b.build())
            } catch (e: Exception) {
                // a broken entry is skipped
            }
        }
        return out
    }
}
