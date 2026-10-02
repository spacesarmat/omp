package com.spacesarmat.omp.sources

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject

/** Persistent cookies of one site (encrypted on the device, see [SecretStorage]). */
interface CookieStore {
    fun load(site: String): String?

    /** null removes the site. */
    fun save(site: String, data: String?)
}

/**
 * Cookies per site (registrable domain, e.g. rutracker.org), kept in memory and saved through [CookieStore]
 * so a tracker session survives restarts. A site's cookies are only sent to URLs they match.
 */
class SiteCookieJar(private val store: CookieStore, private val now: () -> Long = System::currentTimeMillis) : CookieJar {
    private val sites = HashMap<String, MutableList<Cookie>>()

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

    /** Forgets every cookie of the site of [url] (logout). */
    @Synchronized
    fun clear(url: HttpUrl) {
        val site = siteOf(url)
        sites[site] = mutableListOf()
        store.save(site, null)
    }

    private fun cookiesOf(site: String): MutableList<Cookie> =
        sites.getOrPut(site) {
            val t = now()
            CookieCodec.decode(store.load(site)).filter { it.expiresAt > t }.toMutableList()
        }

    private fun persist(site: String, list: List<Cookie>) {
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
