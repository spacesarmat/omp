package com.spacesarmat.omp.sources

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudflareDetectTest {
    private fun headers(vararg kv: Pair<String, String>): (String) -> String? {
        val m = kv.associate { it.first.lowercase() to it.second }
        return { m[it.lowercase()] }
    }

    private val justAMoment = """<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>
        <script>window._cf_chl_opt={cvId:'3'};</script></head><body><div id="challenge-running"></div>
        <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>"""

    private val turnstile = """<html><head><title>Just a moment...</title></head><body>
        <div class="cf-turnstile" data-sitekey="x"></div>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
        <script src="/cdn-cgi/challenge-platform/h/g/orchestrate"></script></body></html>"""

    @Test
    fun mitigatedHeaderIsAChallenge() {
        assertEquals(CloudflareDetect.Kind.CHALLENGE, CloudflareDetect.detect(403, headers("cf-mitigated" to "challenge"), "<html></html>"))
        assertEquals(CloudflareDetect.Kind.CHALLENGE, CloudflareDetect.detect(503, headers("CF-Mitigated" to " Challenge "), ""))
    }

    @Test
    fun cloudflareServerWithChallengePage() {
        assertEquals(CloudflareDetect.Kind.CHALLENGE, CloudflareDetect.detect(403, headers("server" to "cloudflare"), justAMoment))
        assertEquals(CloudflareDetect.Kind.CHALLENGE, CloudflareDetect.detect(503, headers("Server" to "cloudflare"), "<div id=\"cf-chl-widget\"></div>"))
    }

    @Test
    fun turnstileIsInteractive() {
        assertEquals(CloudflareDetect.Kind.INTERACTIVE, CloudflareDetect.detect(403, headers("server" to "cloudflare"), turnstile))
        assertEquals(CloudflareDetect.Kind.INTERACTIVE, CloudflareDetect.detect(403, headers("cf-mitigated" to "challenge"), turnstile))
    }

    @Test
    fun ordinaryAnswersAreNotChallenges() {
        // a normal page through Cloudflare
        assertEquals(CloudflareDetect.Kind.NONE, CloudflareDetect.detect(200, headers("server" to "cloudflare"), justAMoment))
        // the site's own 403 behind Cloudflare, no challenge page
        assertEquals(CloudflareDetect.Kind.NONE, CloudflareDetect.detect(403, headers("server" to "cloudflare"), "<h1>Доступ запрещён</h1>"))
        // challenge-like text from another server
        assertEquals(CloudflareDetect.Kind.NONE, CloudflareDetect.detect(403, headers("server" to "nginx"), justAMoment))
        assertEquals(CloudflareDetect.Kind.NONE, CloudflareDetect.detect(404, headers("cf-mitigated" to "challenge"), justAMoment))
        assertEquals(CloudflareDetect.Kind.NONE, CloudflareDetect.detect(503, headers("cf-mitigated" to "block"), ""))
    }

    // Bot Fight Mode / JavaScript Detections: Cloudflare injects this script into ordinary pages
    private val siteOwn403WithJsd = """<html><head><title>Доступ запрещён</title></head><body><h1>Нужен вход</h1>
        <script>(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';
        document.head.appendChild(a);})();</script></body></html>"""

    @Test
    fun botDetectionScriptIsNotAChallenge() {
        assertEquals(CloudflareDetect.Kind.NONE, CloudflareDetect.detect(403, headers("server" to "cloudflare"), siteOwn403WithJsd))
        assertEquals(CloudflareDetect.Kind.NONE, CloudflareDetect.detect(503, headers("Server" to "cloudflare"), siteOwn403WithJsd))
        // the page probe looks for the challenge orchestration only
        assertTrue(CloudflareDetect.PROBE_JS.contains("/challenge-platform/h/"))
        assertFalse(CloudflareDetect.PROBE_JS.contains("src*=\"challenge-platform\""))
    }

    @Test
    fun probeResults() {
        // evaluateJavascript hands the returned string as a JSON literal
        assertEquals(CloudflareDetect.Page.CLEAR, CloudflareDetect.page("\"{\\\"t\\\":\\\"Трекер\\\",\\\"ch\\\":false,\\\"ts\\\":false}\""))
        assertEquals(CloudflareDetect.Page.CHALLENGE, CloudflareDetect.page("{\"t\":\"Just a moment...\",\"ch\":false,\"ts\":false}"))
        assertEquals(CloudflareDetect.Page.CHALLENGE, CloudflareDetect.page("{\"t\":\"x\",\"ch\":true,\"ts\":false}"))
        assertEquals(CloudflareDetect.Page.TURNSTILE, CloudflareDetect.page("{\"t\":\"x\",\"ch\":true,\"ts\":true}"))
        // a Turnstile widget on an ordinary page (no challenge) is the site's own form
        assertEquals(CloudflareDetect.Page.CLEAR, CloudflareDetect.page("{\"t\":\"Вход\",\"ch\":false,\"ts\":true}"))
        assertEquals(CloudflareDetect.Page.CHALLENGE, CloudflareDetect.page(null))
        assertEquals(CloudflareDetect.Page.CHALLENGE, CloudflareDetect.page("null"))
        assertEquals(CloudflareDetect.Page.CHALLENGE, CloudflareDetect.page("garbage"))
    }
}
