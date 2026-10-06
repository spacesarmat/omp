package com.spacesarmat.omp

import android.webkit.WebSettings

/** The zoom switches of a WebView ([WebSettings]), behind an interface so the unit test can check them. */
interface ZoomSwitches {
    fun setSupportZoom(on: Boolean)
    fun setBuiltInZoomControls(on: Boolean)
    fun setDisplayZoomControls(on: Boolean)
}

/**
 * The phone UI never zooms as a page: no pinch zoom, no double-tap zoom, no zoom buttons. Two-finger gestures still
 * reach the page (the «Каталог» pinch that changes the posters per row is a JS gesture, not a WebView zoom).
 * Capacitor already leaves the built-in zoom off (zoomEnabled false); this states it explicitly, together with the
 * viewport meta of mobile/index.html (maximum-scale=1, user-scalable=no).
 */
object PhoneWebZoom {
    fun disable(s: ZoomSwitches) {
        s.setSupportZoom(false)
        s.setBuiltInZoomControls(false)
        s.setDisplayZoomControls(false)
    }

    fun disable(settings: WebSettings) = disable(object : ZoomSwitches {
        override fun setSupportZoom(on: Boolean) = settings.setSupportZoom(on)
        override fun setBuiltInZoomControls(on: Boolean) { settings.builtInZoomControls = on }
        override fun setDisplayZoomControls(on: Boolean) { settings.displayZoomControls = on }
    })
}
