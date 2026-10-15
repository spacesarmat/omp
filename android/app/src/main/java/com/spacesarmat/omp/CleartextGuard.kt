package com.spacesarmat.omp

import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream

/** A WebView answer that stops a cleartext request [CleartextPolicy] does not allow. Null when the request may proceed. */
object CleartextGuard {
    fun block(uri: Uri?): WebResourceResponse? {
        if (uri == null) return null
        if (!uri.scheme.equals("http", ignoreCase = true)) return null
        val host = uri.host ?: return null
        if (CleartextPolicy.permitted(host)) return null
        return WebResourceResponse(
            "text/plain",
            "utf-8",
            403,
            "Blocked",
            emptyMap(),
            ByteArrayInputStream(ByteArray(0)),
        )
    }
}
