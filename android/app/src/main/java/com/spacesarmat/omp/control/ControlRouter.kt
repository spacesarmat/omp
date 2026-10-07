package com.spacesarmat.omp.control

import com.spacesarmat.omp.I18n

import org.json.JSONException
import org.json.JSONObject

/** What the routes do on the TV (TvRemote on the device, a fake in tests). Called on a server thread. */
interface RemoteActions {
    /** `{ name, version, foreground }`; the router adds `paired`. */
    fun info(): JSONObject
    fun paired(phone: String)
    fun launch(params: JSONObject)
    /** [lang]: the phone's resolved UI language (ru | en), null when none came or an unknown one. */
    fun attach(report: String, lang: String?)
    fun key(name: String)
    /** `{ text }`, `{ delete }` or `{ enter: true }`, already validated. */
    fun text(data: JSONObject)
    fun volume(up: Boolean)
    /** «Передать на телевизор», already validated; blocks until the page applied it (see [SourcesInbox]). */
    fun sources(t: SourcesTransfer): SourcesOutcome
    /** «Пройти на телефоне»: a paired phone polls for a check, waiting up to [waitMs] ([CloudflareRelay.poll]). */
    fun cloudflarePoll(token: String, phone: String, waitMs: Long): JSONObject
    /** The phone's answer to a check, already parsed as JSON ([CloudflareRelay.answer]). */
    fun cloudflareAnswer(token: String, body: JSONObject): CloudflareRelay.Reply
}

/**
 * Routes of the control server (spec «Управление с телефона»). Every route but `/omp/info` and `/omp/pair`
 * needs `Authorization: Bearer <token>`: it is checked before the method and the body (401).
 */
class ControlRouter(private val pairing: Pairing, private val actions: RemoteActions) {
    /**
     * Header stage of `/omp/sources` (it carries a login): the token, method, type and size are checked before the
     * body is read, and more than [SourcesProtocol.MAX_BODY] bytes is never read. Other routes: null (go on).
     */
    fun precheck(h: ControlHead): ControlResponse? {
        val max = when (h.path) {
            SOURCES -> SourcesProtocol.MAX_BODY
            // carries cookies: the same checks before the body is read
            CloudflareProtocol.ANSWER -> CloudflareProtocol.MAX_BODY
            // needs no body: a tiny one at most, after the token
            CloudflareProtocol.POLL -> CloudflareProtocol.MAX_POLL_BODY
            else -> return null
        }
        if (!pairing.isPaired(h.token)) return ControlResponse(401, ControlServer.error("unauthorized"))
        if (h.method != "POST") return methodNotAllowed()
        if (!isJson(h.contentType)) return ControlResponse(415, ControlServer.error("unsupported_media_type"))
        if (h.length > max) return ControlResponse(413, ControlServer.error("too_large"))
        return null
    }

    fun route(req: ControlRequest): ControlResponse {
        when (req.path) {
            "/omp/info" -> {
                if (req.method != "GET") return methodNotAllowed()
                return ok(actions.info().put("paired", pairing.isPaired(req.token)))
            }
            "/omp/pair" -> {
                if (req.method != "POST") return methodNotAllowed()
                // a web page can send a «simple» cross-origin POST (text/plain) without a CORS preflight; JSON needs one
                if (!isJson(req.contentType)) return ControlResponse(415, ControlServer.error("unsupported_media_type"))
                return pair(parse(req.body) ?: return badRequest())
            }
            !in PROTECTED -> return ControlResponse(404, ControlServer.error("not_found"))
        }
        if (!pairing.isPaired(req.token)) return ControlResponse(401, ControlServer.error("unauthorized"))
        if (req.method != "POST") return methodNotAllowed()
        if (req.path == SOURCES) return sources(req)
        if (req.path == CloudflareProtocol.ANSWER) return cloudflareAnswer(req)
        if (req.path == CloudflareProtocol.POLL) {
            val body = parse(req.body) ?: return badRequest()
            return ok(actions.cloudflarePoll(req.token!!, pairing.phoneOf(req.token) ?: I18n.s("phone.default"), CloudflareProtocol.waitOf(body)))
        }
        val body = parse(req.body) ?: return badRequest()
        return when (req.path) {
            "/omp/launch" -> launch(body)
            "/omp/attach" -> attach(body)
            "/omp/key" -> key(body)
            "/omp/text" -> text(body)
            else -> volume(body)
        }
    }

    private fun pair(body: JSONObject): ControlResponse =
        when (val r = pairing.pair(codeOf(body.opt("code")), body.optString("phone"))) {
            is Pairing.Result.Paired -> {
                actions.paired(r.phone)
                ok(JSONObject().put("token", r.token))
            }
            is Pairing.Result.Refused -> ControlResponse(403, ControlServer.error(r.error))
        }

    private fun launch(body: JSONObject): ControlResponse {
        val params = body.opt("params") as? JSONObject ?: return badRequest()
        actions.launch(params)
        return okEmpty()
    }

    private fun attach(body: JSONObject): ControlResponse {
        val report = (body.opt("report") as? String)?.trim() ?: return badRequest()
        if (!REPORT.matches(report) || report.length > MAX_REPORT) return badRequest()
        // an unknown language is ignored, so a newer phone does not break the link
        actions.attach(report, (body.opt("lang") as? String)?.takeIf { it in LANGS })
        return okEmpty()
    }

    private fun key(body: JSONObject): ControlResponse {
        val name = body.opt("name") as? String ?: return badRequest()
        if (name !in KEYS) return badRequest()
        actions.key(name)
        return okEmpty()
    }

    private fun text(body: JSONObject): ControlResponse {
        val text = body.opt("text")
        val del = body.opt("delete")
        val data = when {
            text is String -> if (text.length > MAX_TEXT) return badRequest() else JSONObject().put("text", text)
            del is Number -> {
                val n = del.toDouble()
                if (n != Math.floor(n) || n < 1 || n > MAX_TEXT) return badRequest()
                JSONObject().put("delete", n.toInt())
            }
            body.opt("enter") == true -> JSONObject().put("enter", true)
            else -> return badRequest()
        }
        actions.text(data)
        return okEmpty()
    }

    /** The answer never echoes the request: no login, no password, no API key, only the outcome. */
    private fun sources(req: ControlRequest): ControlResponse {
        if (!isJson(req.contentType)) return ControlResponse(415, ControlServer.error("unsupported_media_type"))
        if (req.body.toByteArray(Charsets.UTF_8).size > SourcesProtocol.MAX_BODY) return ControlResponse(413, ControlServer.error("too_large"))
        val body = parse(req.body) ?: return badRequest()
        val phone = pairing.phoneOf(req.token) ?: I18n.s("phone.default")
        val t = SourcesProtocol.parse(body, phone) ?: return badRequest()
        return when (val r = actions.sources(t)) {
            is SourcesOutcome.Applied -> {
                val o = JSONObject().put("ok", true)
                if (t.login != null) o.put("rutracker", r.rutracker ?: "error")
                // the verified rutracker login could not be written (the site results above still hold)
                if (r.rutrackerNotStored) o.put("rutrackerNotStored", true)
                // how many connections the TV saved; never a key or an address
                if (t.indexers.isNotEmpty()) o.put("indexers", r.indexers ?: 0)
                // per site: ok | bad_login | captcha | error, only for the logins that came
                if (t.logins.isNotEmpty()) {
                    val l = JSONObject()
                    for (site in t.logins.keys) l.put(site, r.logins[site] ?: "error")
                    o.put("logins", l)
                }
                // per browser session: ok | error, never a cookie or a User-Agent
                if (t.sessions.isNotEmpty()) {
                    val x = JSONObject()
                    for (site in t.sessions.keys) x.put(site, r.sessions[site] ?: "error")
                    o.put("sessions", x)
                }
                ok(o)
            }
            SourcesOutcome.Busy -> ControlResponse(409, ControlServer.error("busy"))
            SourcesOutcome.NoAnswer -> ControlResponse(503, ControlServer.error("no_answer"))
            SourcesOutcome.Failed -> ControlResponse(500, ControlServer.error("not_applied"))
            SourcesOutcome.StoreFailed -> ControlResponse(500, ControlServer.error("secrets"))
        }
    }

    /** The answer never echoes the cookies or the User-Agent: only ok or an error code. */
    private fun cloudflareAnswer(req: ControlRequest): ControlResponse {
        if (!isJson(req.contentType)) return ControlResponse(415, ControlServer.error("unsupported_media_type"))
        if (req.body.toByteArray(Charsets.UTF_8).size > CloudflareProtocol.MAX_BODY) return ControlResponse(413, ControlServer.error("too_large"))
        val body = parse(req.body) ?: return badRequest()
        return when (actions.cloudflareAnswer(req.token!!, body)) {
            CloudflareRelay.Reply.OK -> okEmpty()
            CloudflareRelay.Reply.BAD_REQUEST -> badRequest()
            CloudflareRelay.Reply.UNKNOWN -> ControlResponse(404, ControlServer.error("no_request"))
            // the TV closed it itself (passed by remote): the phone says nothing
            CloudflareRelay.Reply.DONE -> ControlResponse(410, ControlServer.error("done"))
            CloudflareRelay.Reply.STORE_FAILED -> ControlResponse(500, ControlServer.error("secrets"))
        }
    }

    private fun volume(body: JSONObject): ControlResponse {
        when (body.opt("dir")) {
            "up" -> actions.volume(true)
            "down" -> actions.volume(false)
            else -> return badRequest()
        }
        return okEmpty()
    }

    companion object {
        private const val SOURCES = "/omp/sources"
        private const val MAX_TEXT = 1000
        private const val MAX_REPORT = 200
        private val PROTECTED = setOf(
            "/omp/launch", "/omp/attach", "/omp/key", "/omp/text", "/omp/volume", "/omp/sources",
            CloudflareProtocol.POLL, CloudflareProtocol.ANSWER,
        )
        val KEYS = setOf("UP", "DOWN", "LEFT", "RIGHT", "ENTER", "BACK", "CATALOG", "NOWPLAYING", "MENU", "INFO", "RED", "GREEN", "YELLOW", "BLUE")
        /** UI languages of OMP (the phone sends its resolved one). */
        val LANGS = setOf("ru", "en")
        private val REPORT = Regex("^http://.+", RegexOption.IGNORE_CASE)

        /** The pairing code as 4 digits: a string as given, a whole JSON number 0..9999 left-padded («0123»). */
        fun codeOf(v: Any?): String? = when (v) {
            is String -> v
            is Number -> {
                val d = v.toDouble()
                if (d == Math.floor(d) && d >= 0 && d <= 9999) d.toInt().toString().padStart(4, '0') else null
            }
            else -> null
        }

        /** `application/json`, parameters (charset) allowed. */
        fun isJson(contentType: String?): Boolean =
            contentType?.substringBefore(';')?.trim()?.equals("application/json", ignoreCase = true) == true

        private fun parse(body: String): JSONObject? = try {
            if (body.isBlank()) JSONObject() else JSONObject(body)
        } catch (_: JSONException) {
            null
        }

        private fun ok(o: JSONObject) = ControlResponse(200, o.toString())
        private fun okEmpty() = ControlResponse(200, "{\"ok\":true}")
        private fun badRequest() = ControlResponse(400, ControlServer.error("bad_request"))
        private fun methodNotAllowed() = ControlResponse(405, ControlServer.error("method_not_allowed"))
    }
}
