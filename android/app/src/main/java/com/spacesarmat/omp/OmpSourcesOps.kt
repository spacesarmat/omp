package com.spacesarmat.omp

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.spacesarmat.omp.control.CloudflareProtocol
import com.spacesarmat.omp.control.CloudflareRelay
import com.spacesarmat.omp.control.HttpWatchTransport
import com.spacesarmat.omp.control.SourcesProtocol
import com.spacesarmat.omp.sources.CheckTarget
import com.spacesarmat.omp.sources.CheckTexts
import com.spacesarmat.omp.sources.BrowserLogin
import com.spacesarmat.omp.sources.CloudflareCheckDialog
import com.spacesarmat.omp.sources.LoginNavigation
import com.spacesarmat.omp.sources.LoginTarget
import com.spacesarmat.omp.sources.SiteSession
import com.spacesarmat.omp.sources.CloudflareSolver
import com.spacesarmat.omp.sources.MainScheduler
import com.spacesarmat.omp.sources.VisibleCheck
import com.spacesarmat.omp.sources.WebViewCloudflareBrowser
import com.spacesarmat.omp.sources.HttpSpec
import com.spacesarmat.omp.sources.SiteHttp
import com.spacesarmat.omp.sources.SiteHttpException
import com.spacesarmat.omp.sources.SourceServices
import com.spacesarmat.omp.sources.TrackerScrape
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject

/** Site HTTP, secrets, Cloudflare and browser login. Bodies for [OmpNativePlugin]. */

internal fun OmpNativePlugin.httpOp(call: PluginCall) {
    val once = CallOnce(call)
    val spec = try {
        HttpSpec.parse(call.data)
    } catch (e: SiteHttpException) {
        return once.reject(e.reason)
    }
    io.execute {
        try {
            val r = sources.request(spec)
            once.resolve(JSObject.fromJSONObject(HttpSpec.reply(r)))
        } catch (e: SiteHttpException) {
            // a Cloudflare failure carries its kind as the code (the page offers the visible check for -interactive)
            if (e.code != null) once.reject(e.reason, e.code) else once.reject(e.reason)
        } catch (e: Exception) {
            once.reject(SiteHttp.NO_ANSWER)
        }
    }
}

internal fun OmpNativePlugin.httpClearCookiesOp(call: PluginCall) {
    val once = CallOnce(call)
    val url = call.getString("url") ?: return once.reject(SiteHttp.BAD_URL)
    io.execute {
        try {
            sources.siteHttp.clearCookies(url)
            once.resolve()
        } catch (e: SiteHttpException) {
            once.reject(e.reason)
        } catch (e: Exception) {
            once.reject(OmpNativePlugin.SECRETS_FAILED)
        }
    }
}

internal fun OmpNativePlugin.secretGetOp(call: PluginCall) {
    val once = CallOnce(call)
    val key = secretKey(call) ?: return once.reject(OmpNativePlugin.SECRETS_FAILED)
    io.execute {
        try {
            once.resolve(JSObject().put("value", sources.secrets.get(key) ?: JSONObject.NULL))
        } catch (e: Exception) {
            // transient Keystore failure: the stored value is kept
            once.reject(OmpNativePlugin.SECRETS_FAILED)
        }
    }
}

internal fun OmpNativePlugin.secretSetOp(call: PluginCall) {
    val once = CallOnce(call)
    val key = secretKey(call) ?: return once.reject(OmpNativePlugin.SECRETS_FAILED)
    val value = call.getString("value") ?: return once.reject(OmpNativePlugin.SECRETS_FAILED)
    io.execute {
        try {
            sources.secrets.set(key, value)
            once.resolve()
        } catch (e: Exception) {
            once.reject(OmpNativePlugin.SECRETS_FAILED)
        }
    }
}

internal fun OmpNativePlugin.secretDeleteOp(call: PluginCall) {
    val once = CallOnce(call)
    val key = secretKey(call) ?: return once.reject(OmpNativePlugin.SECRETS_FAILED)
    io.execute {
        try {
            sources.secrets.delete(key)
            once.resolve()
        } catch (e: Exception) {
            once.reject(OmpNativePlugin.SECRETS_FAILED)
        }
    }
}

/** JS keys live in their own namespace: page code cannot read the cookie entries. */
internal fun OmpNativePlugin.secretKey(call: PluginCall): String? = SourceServices.jsSecretKey(call.getString("key"))

internal fun OmpNativePlugin.cfText(call: PluginCall, key: String): String? =
    call.getString(key)?.filterNot { it.isISOControl() }?.take(400)?.ifEmpty { null }

internal fun OmpNativePlugin.cloudflareVisibleOp(call: PluginCall) {
    val once = CallOnce(call)
    val act = activity ?: return once.reject(OmpNativePlugin.CF_UNAVAILABLE)
    val forTv = call.getString("forTv")
    val watch = if (forTv != null && !TvMode.isTv(context)) OmpNativePlugin.cfWatch(context) else null
    val req = if (forTv != null) watch?.pending()?.takeIf { it.id == forTv } ?: return once.reject(OmpNativePlugin.CF_GONE) else null
    val url = req?.url ?: call.getString("url")
    val root = (url?.toHttpUrlOrNull() ?: return once.reject(SiteHttp.BAD_URL)).let { CloudflareSolver.siteRoot(it) }
    val site = CloudflareProtocol.cleanSite(call.getString("site")) ?: req?.site ?: root.host
    val tvMode = call.getString("mode") == "tv" && TvMode.isTv(context)
    val title = cfText(call, "title") ?: return once.reject(SiteHttp.BAD_REQUEST)
    val text = cfText(call, "text") ?: return once.reject(SiteHttp.BAD_REQUEST)
    val cancel = cfText(call, "cancel") ?: return once.reject(SiteHttp.BAD_REQUEST)
    val errors = HashMap<String, String>()
    call.getObject("errors")?.let { o ->
        for (k in CloudflareRelay.Outcome.values()) (o.opt(k.name) as? String)?.take(400)?.let { errors[k.name] = it }
    }
    val texts = CheckTexts(
        title, text, cfText(call, "note"), cancel, cfText(call, "phone"), cfText(call, "remote"), cfText(call, "hint"),
        cfText(call, "noPhone"), cfText(call, "phoneClosed"), cfText(call, "waiting"), cfText(call, "gateWait"), errors,
    )
    if (!cfOpen.compareAndSet(false, true)) return once.resolve(JSObject().put("result", "busy"))
    val relay = if (tvMode) remote?.cloudflare else null
    val target = if (watch != null && req != null) {
        CheckTarget.Tv { pairs, ua, until ->
            if (pairs == null) {
                watch.answer(req.id, CloudflareProtocol.endedJson(req.id, cancelled = true))
            } else {
                val body = CloudflareProtocol.solvedJson(req.id, root.host, pairs, ua, until)
                    ?: CloudflareProtocol.endedJson(req.id, cancelled = false)
                watch.answer(req.id, body)
            }
        }
    } else {
        CheckTarget.Local { pairs, until -> sources.importClearance(root, pairs, null, until) }
    }
    act.runOnUiThread {
        try {
            val dialog = CloudflareCheckDialog(act, tvMode, texts, phoneButton = relay != null)
            val check = VisibleCheck(
                // a host with a browser session passes with that session's User-Agent (the clearance must match it)
                root, site, texts, { WebViewCloudflareBrowser(act, visible = true) }, MainScheduler(), { sources.baseAgentFor(root.host) },
                System::currentTimeMillis, { io.execute(it) }, target, relay,
                { r ->
                    cfCheck = null
                    cfOpen.set(false)
                    val o = JSObject().put("result", r.result)
                    r.sent?.let { o.put("sent", it) }
                    r.via?.let { o.put("via", it) }
                    once.resolve(o)
                },
            )
            cfCheck = check
            dialog.show(check)
        } catch (e: Exception) {
            val c = cfCheck
            cfCheck = null
            c?.cancel()
            cfOpen.set(false)
            once.resolve(JSObject().put("result", "failed"))
        }
    }
}

internal fun OmpNativePlugin.loginCheck(o: JSONObject?): SiteSession.Check? {
    if (o == null) return null
    val names = ArrayList<String>()
    (o.opt("cookies") as? org.json.JSONArray)?.let { a -> for (i in 0 until a.length()) (a.opt(i) as? String)?.let { names.add(it) } }
    return SiteSession.check(o.opt("path") as? String, o.opt("marker") as? String, o.opt("loginPath") as? String, names)
}

internal fun OmpNativePlugin.loginHosts(call: PluginCall): List<String> {
    val raw = ArrayList<String>()
    call.getArray("hosts")?.let { a -> for (i in 0 until a.length()) (a.opt(i) as? String)?.let { raw.add(it) } }
    return SiteSession.hosts(raw)
}

internal fun OmpNativePlugin.siteBrowserLoginOp(call: PluginCall) {
    val once = CallOnce(call)
    val act = activity ?: return once.reject(OmpNativePlugin.CF_UNAVAILABLE)
    val forTv = call.getString("forTv")
    val watch = if (forTv != null && !TvMode.isTv(context)) OmpNativePlugin.cfWatch(context) else null
    val req = if (forTv != null) {
        watch?.pending()?.takeIf { it.id == forTv && it.kind == CloudflareProtocol.KIND_LOGIN } ?: return once.reject(OmpNativePlugin.CF_GONE)
    } else null
    val hosts = loginHosts(call)
    val check = loginCheck(call.getObject("check")) ?: return once.reject(SiteHttp.BAD_REQUEST)
    // the TV's request names only the site root; the page's own login page on it otherwise
    val start = (if (req != null) req.url.toHttpUrlOrNull()?.resolve(check.loginPath) else call.getString("url")?.toHttpUrlOrNull())
        ?: return once.reject(SiteHttp.BAD_URL)
    if (hosts.isEmpty() || !SiteSession.onSite(start.host, hosts)) return once.reject(SiteHttp.BAD_URL)
    val source = (call.getString("source") ?: req?.source)?.takeIf { Regex("^[a-z0-9][a-z0-9-]{0,39}$").matches(it) }
        ?: return once.reject(SiteHttp.BAD_REQUEST)
    val site = CloudflareProtocol.cleanSite(call.getString("site")) ?: req?.site ?: start.host
    val tvMode = call.getString("mode") == "tv" && TvMode.isTv(context)
    val title = cfText(call, "title") ?: return once.reject(SiteHttp.BAD_REQUEST)
    val text = cfText(call, "text") ?: return once.reject(SiteHttp.BAD_REQUEST)
    val cancel = cfText(call, "cancel") ?: return once.reject(SiteHttp.BAD_REQUEST)
    val errors = HashMap<String, String>()
    call.getObject("errors")?.let { o ->
        for (k in CloudflareRelay.Outcome.values().map { it.name } + BrowserLogin.UNVERIFIED) (o.opt(k) as? String)?.take(400)?.let { errors[k] = it }
    }
    val texts = CheckTexts(
        title, text, cfText(call, "note"), cancel, cfText(call, "phone"), cfText(call, "remote"), cfText(call, "hint"),
        cfText(call, "noPhone"), cfText(call, "phoneClosed"), cfText(call, "waiting"), cfText(call, "gateWait"), errors,
        cfText(call, "blocked"), cfText(call, "checking"), cfText(call, "notConfirmed"), cfText(call, "retry"),
    )
    if (!cfOpen.compareAndSet(false, true)) return once.resolve(JSObject().put("result", "busy"))
    val relay = if (tvMode) remote?.cloudflare else null
    val target = if (watch != null && req != null) {
        LoginTarget.Tv { host, pairs, ua ->
            val body = if (pairs == null || host == null) {
                CloudflareProtocol.endedJson(req.id, cancelled = true)
            } else {
                CloudflareProtocol.sessionJson(req.id, host, pairs, ua, System.currentTimeMillis() + SiteSession.SESSION_TTL_MS)
                    ?: CloudflareProtocol.endedJson(req.id, cancelled = false)
            }
            watch.answer(req.id, body)
        }
    } else {
        LoginTarget.Local { root, pairs, ua -> sources.importSession(root, pairs, ua) }
    }
    act.runOnUiThread {
        try {
            val dialog = CloudflareCheckDialog(act, tvMode, texts, phoneButton = relay != null)
            val login = BrowserLogin(
                start, hosts, check, site, source, texts,
                {
                    WebViewCloudflareBrowser(
                        act, visible = true,
                        navigation = { h, p -> LoginNavigation.allowed(hosts, h, p) },
                        ads = { h, p -> LoginNavigation.ad(hosts, h, p) },
                    )
                },
                MainScheduler(), sources::userAgent, { io.execute(it) },
                { root, pairs, ua -> sources.verifySession(root, pairs, ua, check) },
                target, relay,
                done = { r ->
                    cfCheck = null
                    cfOpen.set(false)
                    val o = JSObject().put("result", r.result)
                    r.sent?.let { o.put("sent", it) }
                    r.via?.let { o.put("via", it) }
                    r.host?.let { o.put("host", it) }
                    once.resolve(o)
                },
                askPhoneFirst = relay != null && call.getBoolean("askPhone") == true,
            )
            cfCheck = login
            dialog.show(login)
        } catch (e: Exception) {
            val c = cfCheck
            cfCheck = null
            c?.cancel()
            cfOpen.set(false)
            once.resolve(JSObject().put("result", "failed"))
        }
    }
}

internal fun OmpNativePlugin.siteSessionPendingOp(call: PluginCall) {
    val once = CallOnce(call)
    val r = remote ?: return once.reject(I18n.s("plugin.remoteUnavailable"))
    val site = call.getString("site") ?: return once.reject(SiteHttp.BAD_REQUEST)
    val check = loginCheck(call.getObject("check")) ?: return once.reject(SiteHttp.BAD_REQUEST)
    io.execute {
        val s = try {
            r.sessions.staged(site)
        } catch (e: Exception) {
            null
        }
        if (s == null) return@execute once.resolve(JSObject().put("ok", false))
        val root = okhttp3.HttpUrl.Builder().scheme("https").host(s.host).build()
        val ok = try {
            sources.verifySession(root, s.cookies, s.ua ?: sources.userAgent(), check)
        } catch (e: Exception) {
            false
        }
        once.resolve(JSObject().put("ok", ok).put("host", s.host))
    }
}

internal fun OmpNativePlugin.pairedTvOp(call: PluginCall) {
    if (TvMode.isTv(context)) return call.resolve()
    val url = call.getString("url")
    val token = call.getString("token")
    if (url == null || token == null) {
        OmpNativePlugin.paired = null
        return call.resolve()
    }
    if (!OmpNativePlugin.CF_BASE.matches(url) || !OmpNativePlugin.CF_TOKEN.matches(token)) return call.reject(SiteHttp.BAD_REQUEST)
    OmpNativePlugin.paired = url to token
    call.resolve()
}

internal fun OmpNativePlugin.siteSessionSendOp(call: PluginCall) {
    val once = CallOnce(call)
    if (TvMode.isTv(context)) return once.reject(SiteHttp.BAD_REQUEST)
    val (url, token) = OmpNativePlugin.paired ?: return once.reject(OmpNativePlugin.NOT_PAIRED)
    val payload = call.getObject("payload") ?: return once.reject(SiteHttp.BAD_REQUEST)
    val wanted = call.getObject("sessions") ?: return once.reject(SiteHttp.BAD_REQUEST)
    val timeout = (call.getInt("timeoutMs") ?: 45_000).coerceIn(5_000, 60_000)
    io.execute {
        try {
            val sessions = JSONObject()
            val missing = org.json.JSONArray()
            val ids = wanted.keys()
            while (ids.hasNext()) {
                val id = ids.next()
                val raw = ArrayList<String>()
                (wanted.opt(id) as? org.json.JSONArray)?.let { a -> for (i in 0 until a.length()) (a.opt(i) as? String)?.let { raw.add(it) } }
                var found: JSONObject? = null
                val allowed = SourcesProtocol.SESSION_HOSTS[id].orEmpty()
                for (h in SiteSession.hosts(raw).filter { it in allowed }) {
                    val root = okhttp3.HttpUrl.Builder().scheme("https").host(h).build()
                    val pairs = sources.sessionCookies(root)
                    if (pairs.none { !com.spacesarmat.omp.sources.CloudflareCookies.isCloudflare(it.first) }) continue
                    val arr = org.json.JSONArray()
                    for ((n, v) in pairs) arr.put(JSONObject().put("name", n).put("value", v))
                    found = JSONObject().put("host", h).put("cookies", arr).put("ua", sources.agentFor(h))
                    break
                }
                if (found != null) sessions.put(id, found) else missing.put(id)
            }
            val body = JSONObject(payload.toString())
            if (sessions.length() > 0) body.put("sessions", sessions)
            val (status, text) = HttpWatchTransport().post("$url/omp/sources", token, body.toString(), timeout)
            val data = try {
                JSONObject(text)
            } catch (e: Exception) {
                JSONObject()
            }
            once.resolve(JSObject().put("status", status).put("data", data).put("missing", missing))
        } catch (e: Exception) {
            once.reject(OmpNativePlugin.TV_NO_ANSWER)
        }
    }
}

internal fun OmpNativePlugin.cloudflareDeclineOp(call: PluginCall) {
    val id = call.getString("id")
    if (TvMode.isTv(context) || !CloudflareProtocol.validId(id)) return call.resolve()
    val w = OmpNativePlugin.cfWatch(context)
    io.execute { w.answer(id!!, CloudflareProtocol.endedJson(id, cancelled = false)) }
    call.resolve()
}

internal fun OmpNativePlugin.cloudflareClearanceOp(call: PluginCall) {
    val once = CallOnce(call)
    val url = call.getString("url")?.toHttpUrlOrNull() ?: return once.reject(SiteHttp.BAD_URL)
    io.execute {
        try {
            once.resolve(JSObject().put("until", sources.clearanceUntil(url) ?: JSONObject.NULL))
        } catch (e: Exception) {
            once.reject(OmpNativePlugin.SECRETS_FAILED)
        }
    }
}

internal fun OmpNativePlugin.cloudflareWatchOp(call: PluginCall) {
    if (TvMode.isTv(context)) return call.resolve()
    val url = call.getString("url")
    val token = call.getString("token")
    cfText(call, "notify")?.let { OmpNativePlugin.cfNotify = it }
    cfText(call, "notifyLogin")?.let { OmpNativePlugin.cfNotifyLogin = it }
    val w = OmpNativePlugin.cfWatch(context)
    if (url == null || token == null) {
        w.configure(null, null)
        return call.resolve()
    }
    if (!OmpNativePlugin.CF_BASE.matches(url) || !OmpNativePlugin.CF_TOKEN.matches(token)) return call.reject(SiteHttp.BAD_REQUEST)
    w.configure(url, token)
    w.start()
    call.resolve()
}

internal fun OmpNativePlugin.cloudflarePendingOp(call: PluginCall) {
    val r = if (TvMode.isTv(context)) null else OmpNativePlugin.cfWatch(context).pending()
    call.resolve(JSObject.fromJSONObject(CloudflareProtocol.requestJson(r)))
}

private val SCRAPE_ID = Regex("^[A-Za-z0-9]{1,40}$")

/** { kind: http|udp, id, timeoutMs, url? | host, port, infohash } → { text } or { seeders, leechers, completed }. */
internal fun OmpNativePlugin.trackerScrapeOp(call: PluginCall) {
    val once = CallOnce(call)
    val id = call.getString("id") ?: return once.reject("bad")
    if (!SCRAPE_ID.matches(id)) return once.reject("bad")
    val kind = call.getString("kind") ?: return once.reject("bad")
    val timeout = call.data.optInt("timeoutMs", 3000).coerceIn(500, 5000)
    io.execute {
        try {
            when (kind) {
                "http" -> {
                    val url = call.getString("url") ?: return@execute once.reject("bad")
                    once.resolve(JSObject().put("text", TrackerScrape.http(id, url, timeout)))
                }
                "udp" -> {
                    val host = call.getString("host") ?: return@execute once.reject("bad")
                    val port = call.data.optInt("port", -1)
                    val hash = call.getString("infohash") ?: return@execute once.reject("bad")
                    val c = TrackerScrape.udp(id, host, port, hash, timeout) ?: return@execute once.reject("no-answer")
                    val o = JSObject()
                    o.put("seeders", c.seeders)
                    o.put("leechers", c.leechers)
                    o.put("completed", c.completed)
                    once.resolve(o)
                }
                else -> once.reject("bad")
            }
        } catch (_: Exception) {
            once.reject("no-answer")
        }
    }
}

internal fun OmpNativePlugin.trackerScrapeCancelOp(call: PluginCall) {
    val id = call.getString("id")
    if (id != null && SCRAPE_ID.matches(id)) TrackerScrape.cancel(id)
    call.resolve()
}

internal fun OmpNativePlugin.emitCloudflare(r: CloudflareProtocol.Request): Boolean {
    if (!listening("cloudflareRequest")) return false
    val o = JSObject().put("id", r.id).put("site", r.site).put("url", r.url)
    if (r.kind == CloudflareProtocol.KIND_LOGIN) o.put("kind", r.kind).put("source", r.source)
    emit("cloudflareRequest", o)
    return true
}
