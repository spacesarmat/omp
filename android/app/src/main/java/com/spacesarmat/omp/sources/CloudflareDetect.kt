package com.spacesarmat.omp.sources

import org.json.JSONObject

/**
 * Is a site answer a Cloudflare check instead of the page? Pure: tested on the JVM with header / page fixtures.
 * A 403/503 with `cf-mitigated: challenge`, or from `server: cloudflare` with the challenge page markers
 * («Just a moment…», the challenge orchestration /cdn-cgi/challenge-platform/h/, cf-chl-, _cf_chl_opt). Cloudflare's
 * bot-detection script on ordinary pages (/cdn-cgi/challenge-platform/scripts/jsd/) is NOT a check: a site's own 403
 * behind Cloudflare stays a plain answer. A Turnstile widget on a challenge page needs a tick by a person.
 */
object CloudflareDetect {
    enum class Kind { NONE, CHALLENGE, INTERACTIVE }

    /** What the hidden browser sees on the page (see [PROBE_JS]). */
    enum class Page { CLEAR, CHALLENGE, TURNSTILE }

    private val STATUSES = setOf(403, 503)

    private val CHALLENGE_MARKERS = listOf(
        Regex("<title>\\s*Just a moment", RegexOption.IGNORE_CASE),
        Regex("/cdn-cgi/challenge-platform/h/"),
        Regex("cf-chl-"),
        Regex("_cf_chl_opt"),
        Regex("id=[\"']challenge-(form|running|stage)"),
    )

    private val TURNSTILE_MARKERS = listOf(
        Regex("cf-turnstile"),
        Regex("turnstile/v0/api\\.js"),
        Regex("name=[\"']cf-turnstile-response"),
    )

    /** [header] reads a response header by name (case-insensitive), null when absent. */
    fun detect(status: Int, header: (String) -> String?, body: String): Kind {
        if (status !in STATUSES) return Kind.NONE
        val mitigated = header("cf-mitigated")?.trim()?.equals("challenge", ignoreCase = true) == true
        val fromCloudflare = header("server")?.contains("cloudflare", ignoreCase = true) == true
        val page = body.take(SCAN_CHARS)
        val challengePage = CHALLENGE_MARKERS.any { it.containsMatchIn(page) }
        if (!mitigated && !(fromCloudflare && challengePage)) return Kind.NONE
        return if (TURNSTILE_MARKERS.any { it.containsMatchIn(page) }) Kind.INTERACTIVE else Kind.CHALLENGE
    }

    /**
     * The hidden browser's probe result ({"t": title, "ch": challenge markers, "ts": Turnstile widget}) as a [Page].
     * Anything unreadable counts as a challenge still shown.
     */
    fun page(probe: String?): Page {
        val o = parseProbe(probe) ?: return Page.CHALLENGE
        val title = o.optString("t", "")
        val challenge = o.optBoolean("ch", false) || Regex("^\\s*Just a moment", RegexOption.IGNORE_CASE).containsMatchIn(title)
        if (!challenge) return Page.CLEAR
        return if (o.optBoolean("ts", false)) Page.TURNSTILE else Page.CHALLENGE
    }

    /** evaluateJavascript hands a JSON string literal of the returned string: unwrap it once. */
    private fun parseProbe(probe: String?): JSONObject? {
        if (probe.isNullOrEmpty() || probe == "null") return null
        return try {
            val raw = if (probe.startsWith("\"")) JSONObject("{\"v\":$probe}").getString("v") else probe
            JSONObject(raw)
        } catch (e: Exception) {
            null
        }
    }

    private const val SCAN_CHARS = 200_000

    /** Runs in the hidden page: title + markers, never the page text itself. */
    const val PROBE_JS = "(function(){try{var d=document,h=d.documentElement?d.documentElement.innerHTML.slice(0,200000):'';" +
        "var ch=!!d.querySelector('#challenge-form,#challenge-running,#challenge-stage,script[src*=\"/challenge-platform/h/\"]')||/cf-chl-|_cf_chl_opt/.test(h)||h.indexOf('/challenge-platform/h/')>=0;" +
        "var ts=!!d.querySelector('.cf-turnstile,iframe[src*=\"challenges.cloudflare.com\"],input[name=\"cf-turnstile-response\"]');" +
        "return JSON.stringify({t:String(d.title||'').slice(0,100),ch:ch,ts:ts});}catch(e){return null;}})()"
}
