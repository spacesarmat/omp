package com.spacesarmat.omp

import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import kotlin.math.abs
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.yandex.mobile.ads.common.AdBindingResult
import com.yandex.mobile.ads.common.AdRequest
import com.yandex.mobile.ads.common.AdRequestError
import com.yandex.mobile.ads.common.YandexAds
import com.yandex.mobile.ads.nativeads.NativeAd
import com.yandex.mobile.ads.nativeads.NativeAdLoadListener
import com.yandex.mobile.ads.nativeads.NativeAdLoader
import com.yandex.mobile.ads.nativeads.NativeAdView
import com.yandex.mobile.ads.nativeads.NativeAdViewBinder

/**
 * Native Yandex ads for the phone UI. The page reserves a card-sized cell and this plugin paints the
 * bound NativeAdView over it. TV never initializes the SDK. A miss or an error rejects the call so the
 * page can show an own banner.
 */
@CapacitorPlugin(name = "YandexAds")
class YandexAdsPlugin : Plugin() {
    private class Slot(val loader: NativeAdLoader, val ad: NativeAd, val view: NativeAdView, val clip: FrameLayout)

    private val slots = HashMap<String, Slot>()
    private val waiters = ArrayList<() -> Unit>()
    private var ready = false
    private var starting = false

    @PluginMethod
    fun load(call: PluginCall) {
        val act = activity ?: return call.reject("no-activity")
        if (TvMode.isTv(context)) return call.reject("unsupported")
        val slotId = call.getString("slotId")?.trim()?.take(80) ?: return call.reject("bad-slot")
        val unit = call.getString("adUnitId")?.trim() ?: return call.reject("bad-unit")
        if (!YandexAdsUnits.accept(unit)) return call.reject("bad-unit")
        val row = call.getString("layout") == "row"
        act.runOnUiThread {
            ensureInit {
                val loader = NativeAdLoader(context)
                loader.loadAd(
                    AdRequest.Builder(unit).build(),
                    object : NativeAdLoadListener {
                        override fun onAdLoaded(nativeAd: NativeAd) {
                            act.runOnUiThread {
                            val layout = if (row) R.layout.yandex_native_row else R.layout.yandex_native_card
                            val root = act.layoutInflater.inflate(layout, null) as NativeAdView
                            if (!bind(nativeAd, root)) {
                                drop(slotId)
                                call.reject("bind")
                                return@runOnUiThread
                            }
                            slots[slotId]?.let { old -> (old.clip.parent as? ViewGroup)?.removeView(old.clip) }
                            val clip = ClipFrame(act)
                            clip.clipChildren = true
                            clip.clipToPadding = true
                            clip.addView(root, FrameLayout.LayoutParams(1, 1))
                            slots[slotId] = Slot(loader, nativeAd, root, clip)
                            call.resolve()
                            }
                        }

                        override fun onAdFailedToLoad(error: AdRequestError) {
                            act.runOnUiThread { call.reject("nofill", error.description) }
                        }
                    },
                )
            }
        }
    }

    @PluginMethod
    fun place(call: PluginCall) {
        val act = activity ?: return call.reject("no-activity")
        val slotId = call.getString("slotId") ?: return call.reject("bad-slot")
        val x = call.getDouble("x")
        val y = call.getDouble("y")
        val width = call.getDouble("width")
        val height = call.getDouble("height")
        val viewport = call.getDouble("viewportWidth")
        val clipTop = call.getDouble("clipTop")
        val clipBottom = call.getDouble("clipBottom")
        if (x == null || y == null || width == null || height == null || viewport == null) return call.reject("bad-rect")
        act.runOnUiThread {
            val slot = slots[slotId] ?: return@runOnUiThread call.reject("gone")
            val host = host() ?: return@runOnUiThread call.reject("no-host")
            val web = bridge.webView ?: return@runOnUiThread call.reject("no-web")
            val webLoc = IntArray(2)
            val hostLoc = IntArray(2)
            web.getLocationOnScreen(webLoc)
            host.getLocationOnScreen(hostLoc)
            val scale = if (viewport > 0) web.width.toDouble() / viewport else web.resources.displayMetrics.density.toDouble()
            val top = clipTop ?: y
            val bottom = clipBottom ?: (y + height)
            val visTop = maxOf(y, top)
            val visBottom = minOf(y + height, bottom)
            val visHeight = visBottom - visTop
            if (visHeight < 1 || width < 1) {
                slot.clip.visibility = View.GONE
                call.resolve()
                return@runOnUiThread
            }
            if (slot.clip.parent !== host) {
                (slot.clip.parent as? ViewGroup)?.removeView(slot.clip)
                host.addView(slot.clip, FrameLayout.LayoutParams(1, 1))
            }
            val lp = slot.clip.layoutParams as FrameLayout.LayoutParams
            lp.width = (width * scale).toInt().coerceAtLeast(1)
            lp.height = (visHeight * scale).toInt().coerceAtLeast(1)
            slot.clip.layoutParams = lp
            slot.clip.x = (webLoc[0] - hostLoc[0] + x * scale).toFloat()
            slot.clip.y = (webLoc[1] - hostLoc[1] + visTop * scale).toFloat()
            val inner = slot.view.layoutParams as FrameLayout.LayoutParams
            inner.width = (width * scale).toInt().coerceAtLeast(1)
            inner.height = (height * scale).toInt().coerceAtLeast(1)
            slot.view.layoutParams = inner
            slot.view.x = 0f
            slot.view.y = ((y - visTop) * scale).toFloat()
            slot.view.visibility = View.VISIBLE
            slot.clip.visibility = View.VISIBLE
            call.resolve()
        }
    }

    @PluginMethod
    fun conceal(call: PluginCall) {
        val slotId = call.getString("slotId") ?: return call.reject("bad-slot")
        val act = activity ?: return call.resolve()
        act.runOnUiThread {
            slots[slotId]?.clip?.visibility = View.GONE
            call.resolve()
        }
    }

    @PluginMethod
    fun hide(call: PluginCall) {
        val slotId = call.getString("slotId") ?: return call.reject("bad-slot")
        val act = activity
        if (act == null) {
            drop(slotId)
            return call.resolve()
        }
        act.runOnUiThread {
            drop(slotId)
            call.resolve()
        }
    }

    @PluginMethod
    fun hideAll(call: PluginCall) {
        val act = activity
        if (act == null) {
            slots.clear()
            return call.resolve()
        }
        act.runOnUiThread {
            clear()
            call.resolve()
        }
    }

    override fun handleOnDestroy() {
        activity?.runOnUiThread { clear() }
        super.handleOnDestroy()
    }

    private fun ensureInit(done: () -> Unit) {
        if (TvMode.isTv(context)) return
        if (ready) {
            done()
            return
        }
        waiters.add(done)
        if (starting) return
        starting = true
        YandexAds.setLocationTracking(false)
        YandexAds.setAgeRestricted(false)
        YandexAds.initialize(context) {
            ready = true
            val copy = waiters.toList()
            waiters.clear()
            val act = activity
            if (act == null) copy.forEach { it() }
            else act.runOnUiThread { copy.forEach { it() } }
        }
    }

    private fun bind(ad: NativeAd, root: NativeAdView): Boolean {
        val binder = NativeAdViewBinder.Builder(root)
            .setAgeView(root.findViewById(R.id.yandex_age))
            .setBodyView(root.findViewById(R.id.yandex_body))
            .setCallToActionView(root.findViewById(R.id.yandex_cta))
            .setDomainView(root.findViewById(R.id.yandex_domain))
            .setFaviconView(root.findViewById(R.id.yandex_favicon))
            .setFeedbackView(root.findViewById(R.id.yandex_feedback))
            .setIconView(root.findViewById(R.id.yandex_icon))
            .setMediaView(root.findViewById(R.id.yandex_media))
            .setPriceView(root.findViewById(R.id.yandex_price))
            .setRatingView(root.findViewById(R.id.yandex_rating))
            .setReviewCountView(root.findViewById(R.id.yandex_reviews))
            .setSponsoredView(root.findViewById(R.id.yandex_sponsored))
            .setTitleView(root.findViewById(R.id.yandex_title))
            .setWarningView(root.findViewById(R.id.yandex_warning))
            .build()
        if (ad.bindNativeAd(binder) is AdBindingResult.Failure) return false
        val sponsored = root.findViewById<TextView>(R.id.yandex_sponsored)
        if (sponsored.text.isNullOrBlank()) sponsored.text = "Реклама"
        return true
    }

    /** A drag that starts on the ad is a catalog scroll. A short tap stays on the ad. */
    private inner class ClipFrame(context: android.content.Context) : FrameLayout(context) {
        private var downRawX = 0f
        private var downRawY = 0f
        private var dragging = false
        private var sentDown = false
        private val slop = ViewConfiguration.get(context).scaledTouchSlop

        override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = ev.rawX
                    downRawY = ev.rawY
                    dragging = false
                    sentDown = false
                    return false
                }
                MotionEvent.ACTION_MOVE -> {
                    if (abs(ev.rawX - downRawX) > slop || abs(ev.rawY - downRawY) > slop) {
                        dragging = true
                        return true
                    }
                }
            }
            return false
        }

        override fun onTouchEvent(ev: MotionEvent): Boolean {
            if (!dragging) return super.onTouchEvent(ev)
            val target = bridge.webView
            if (target != null) {
                val loc = IntArray(2)
                target.getLocationOnScreen(loc)
                if (!sentDown) {
                    val down = MotionEvent.obtain(
                        ev.downTime,
                        ev.eventTime,
                        MotionEvent.ACTION_DOWN,
                        downRawX - loc[0],
                        downRawY - loc[1],
                        ev.metaState,
                    )
                    target.dispatchTouchEvent(down)
                    down.recycle()
                    sentDown = true
                }
                val copy = MotionEvent.obtain(ev)
                copy.setLocation(ev.rawX - loc[0], ev.rawY - loc[1])
                target.dispatchTouchEvent(copy)
                copy.recycle()
            }
            if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) {
                dragging = false
                sentDown = false
            }
            return true
        }
    }

    private fun host(): FrameLayout? {
        val act = activity ?: return null
        val content = act.findViewById<ViewGroup>(android.R.id.content) ?: return null
        val existing = content.findViewById<FrameLayout>(R.id.yandex_ad_host)
        if (existing != null) return existing
        val host = FrameLayout(act)
        host.id = R.id.yandex_ad_host
        host.isClickable = false
        host.clipChildren = true
        content.addView(host, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return host
    }

    private fun drop(slotId: String) {
        val slot = slots.remove(slotId) ?: return
        (slot.clip.parent as? ViewGroup)?.removeView(slot.clip)
    }

    private fun clear() {
        val ids = slots.keys.toList()
        for (id in ids) drop(id)
    }
}
