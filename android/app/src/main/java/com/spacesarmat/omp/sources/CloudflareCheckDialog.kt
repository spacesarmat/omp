package com.spacesarmat.omp.sources

import android.app.Activity
import android.app.Dialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.spacesarmat.omp.control.CloudflareProtocol
import com.spacesarmat.omp.control.CloudflareRelay
import com.spacesarmat.omp.control.CloudflareWatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.HttpUrl

/**
 * The texts of the visible check, all from the page (src/sources/cloudflareCheck.ts): Russian copy lives in one place.
 * [hint] and [waiting] may hold «%s» for the phone's name.
 */
class CheckTexts(
    val title: String,
    val text: String,
    val note: String?,
    val cancel: String,
    val phone: String?,
    val remote: String?,
    val hint: String?,
    val noPhone: String?,
    val waiting: String?,
    /** By [CloudflareRelay.Outcome] name: what the hint says when the phone did not pass it. */
    val errors: Map<String, String>,
)

/** How the visible check ended. [sent]: the phone passed it for the TV and the TV took the answer. */
class CheckResult(val result: String, val sent: Boolean? = null, val via: String? = null)

/**
 * The visible Cloudflare check (spec §3): the site root in a WebView with this device's User-Agent, shown as a bottom
 * sheet on the phone or a dialog under the remote on Android TV («Пройти на телефоне», «Отметить пультом», «Отмена»).
 * It holds [CloudflareSolver.WEB_CHECKS] while open (waits up to [GATE_WAIT_MS] for a hidden check to end). When
 * `cf_clearance` appears the cookies go to the encrypted jar ([SourceServices.importClearance]) — or, when the phone
 * passes it for the TV ([answerTo]), only to that TV over the pairing channel — and the WebView's own copy is expired.
 * On the TV «Пройти на телефоне» asks the paired phone through [relay]; the phone's cookies are stored by the relay.
 * Nothing is logged. [done] is called once, on the main thread. Main thread only.
 */
class CloudflareCheckDialog(
    private val activity: Activity,
    private val root: HttpUrl,
    private val site: String,
    private val tv: Boolean,
    private val texts: CheckTexts,
    private val services: SourceServices,
    private val io: ExecutorService,
    private val relay: CloudflareRelay?,
    /** The phone passes it for the TV: the watch that took the request and the request id. */
    private val answerTo: Pair<CloudflareWatch, String>?,
    private val done: (CheckResult) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val ended = AtomicBoolean(false)
    private var browser: WebViewCloudflareBrowser? = null
    private var dialog: Dialog? = null
    private var entered = false
    private var askingPhone = false
    private var hintView: TextView? = null
    private var remoteBtn: TextView? = null
    private var opened = 0L

    fun show() {
        enter(System.currentTimeMillis())
    }

    private fun enter(since: Long) {
        if (ended.get()) return
        if (CloudflareSolver.WEB_CHECKS.tryEnter()) {
            entered = true
            return open()
        }
        if (System.currentTimeMillis() - since >= GATE_WAIT_MS) return finish(CheckResult("busy"))
        main.postDelayed({ enter(since) }, POLL_MS)
    }

    private fun open() {
        val b = try {
            WebViewCloudflareBrowser(activity, visible = true)
        } catch (e: Throwable) {
            return finish(CheckResult("failed"))
        }
        browser = b
        try {
            b.open(root.toString(), services.userAgent(), object : CloudflareBrowser.Events {
                override fun onFinished() {}
                // an error page is shown to the person as it is: «Отмена» closes it
                override fun onError() {}
            })
        } catch (e: Throwable) {
            return finish(CheckResult("failed"))
        }
        val web = b.view ?: return finish(CheckResult("failed"))
        val d = try {
            build(web)
        } catch (e: Throwable) {
            return finish(CheckResult("failed"))
        }
        dialog = d
        try {
            d.show()
        } catch (e: Throwable) {
            return finish(CheckResult("failed"))
        }
        opened = System.currentTimeMillis()
        main.postDelayed({ poll() }, POLL_MS)
    }

    private fun poll() {
        if (ended.get()) return
        val b = browser ?: return
        val pairs = try {
            CloudflareSolver.parseCookieHeader(b.cookies(root.toString()))
        } catch (e: Throwable) {
            emptyList()
        }
        if (pairs.any { it.first == CloudflareSolver.CLEARANCE }) return cleared(pairs)
        if (System.currentTimeMillis() - opened >= MAX_OPEN_MS) return cancel()
        main.postDelayed({ poll() }, POLL_MS)
    }

    /** The person passed it here: the cookies are taken, the page closed, then they are stored or sent. */
    private fun cleared(pairs: List<Pair<String, String>>) {
        if (!ended.compareAndSet(false, true)) return
        relay?.cancel()
        val until = System.currentTimeMillis() + CloudflareSolver.COPIED_TTL_MS
        val ua = services.userAgent()
        close()
        val to = answerTo
        io.execute {
            val r = if (to != null) {
                val body = CloudflareProtocol.solvedJson(to.second, root.host, pairs, ua, until)
                if (body == null) {
                    to.first.answer(to.second, CloudflareProtocol.endedJson(to.second, cancelled = false))
                    CheckResult("failed")
                } else {
                    CheckResult("solved", sent = to.first.answer(to.second, body) == 200)
                }
            } else {
                try {
                    services.importClearance(root, pairs, null, until)
                    CheckResult("solved", via = "here")
                } catch (e: Exception) {
                    CheckResult("failed")
                }
            }
            main.post { done(r) }
        }
    }

    private fun cancel() {
        if (!ended.compareAndSet(false, true)) return
        relay?.cancel()
        close()
        val to = answerTo
        if (to != null) io.execute { to.first.answer(to.second, CloudflareProtocol.endedJson(to.second, cancelled = true)) }
        done(CheckResult("cancelled"))
    }

    private fun finish(r: CheckResult) {
        if (!ended.compareAndSet(false, true)) return
        close()
        done(r)
    }

    private fun close() {
        main.removeCallbacksAndMessages(null)
        val b = browser
        browser = null
        if (b != null) {
            try {
                b.forget(root.toString())
            } catch (e: Throwable) {
                // nothing to drop
            }
            try {
                b.close()
            } catch (e: Throwable) {
                // closing a broken page must not lose the result
            }
        }
        if (entered) {
            entered = false
            CloudflareSolver.WEB_CHECKS.leave()
        }
        val d = dialog
        dialog = null
        try {
            d?.setOnDismissListener(null)
            d?.dismiss()
        } catch (e: Throwable) {
            // the activity is gone
        }
    }

    // ---- «Пройти на телефоне» (TV) ----

    private fun askPhone() {
        val r = relay ?: return
        if (askingPhone || ended.get()) return
        val phone = r.phone()
        if (phone == null) {
            setHint(texts.noPhone)
            return
        }
        askingPhone = true
        setHint(texts.waiting?.replace("%s", phone))
        io.execute {
            val outcome = r.ask(site, root)
            main.post {
                askingPhone = false
                if (ended.get()) return@post
                if (outcome == CloudflareRelay.Outcome.SOLVED) {
                    // the relay has stored the phone's cookies and User-Agent
                    finish(CheckResult("solved", via = "phone"))
                } else {
                    setHint(if (outcome == CloudflareRelay.Outcome.NO_PHONE) texts.noPhone else texts.errors[outcome.name])
                }
            }
        }
    }

    private fun setHint(s: String?) {
        hintView?.let {
            it.text = s ?: ""
            it.visibility = if (s.isNullOrEmpty()) View.GONE else View.VISIBLE
        }
    }

    // ---- layout ----

    private fun dp(v: Float): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, activity.resources.displayMetrics).toInt()

    private fun label(text: String, sp: Float, color: Int, bold: Boolean = false): TextView = TextView(activity).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        setLineSpacing(0f, 1.2f)
    }

    private fun rounded(color: Int, radius: Float): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
    }

    private fun button(text: String, primary: Boolean, onClick: () -> Unit): TextView = TextView(activity).apply {
        this.text = text
        gravity = Gravity.CENTER
        typeface = Typeface.DEFAULT_BOLD
        isFocusable = true
        isClickable = true
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        val normal = if (primary && !tv) ACCENT else BUTTON
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), rounded(ACCENT, 12f))
            addState(intArrayOf(android.R.attr.state_pressed), rounded(ACCENT, 12f))
            addState(intArrayOf(), rounded(normal, 12f))
        }
        setTextColor(
            ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_focused), intArrayOf(android.R.attr.state_pressed), intArrayOf()),
                intArrayOf(DARK, DARK, if (normal == ACCENT) DARK else TEXT),
            ),
        )
        setPadding(dp(20f), 0, dp(20f), 0)
        setOnClickListener { onClick() }
    }

    private fun build(web: View): Dialog {
        val d = Dialog(activity)
        d.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            background = if (tv) {
                rounded(SHEET, 20f)
            } else {
                GradientDrawable().apply {
                    setColor(SHEET)
                    val r = dp(22f).toFloat()
                    cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
                }
            }
            setPadding(dp(if (tv) 24f else 16f), dp(if (tv) 20f else 14f), dp(if (tv) 24f else 16f), dp(if (tv) 18f else 20f))
        }
        val gap = dp(if (tv) 8f else 10f)
        fun add(v: View, lp: LinearLayout.LayoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) {
            if (box.childCount > 0) lp.topMargin = gap
            box.addView(v, lp)
        }
        if (!tv) {
            add(View(activity).apply { background = rounded(HANDLE, 2f) }, LinearLayout.LayoutParams(dp(40f), dp(4f)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        }
        add(label(texts.title, if (tv) 20f else 18f, TEXT, bold = true))
        add(label(texts.text, if (tv) 14f else 13f, MUTED))
        val frame = FrameLayout(activity).apply {
            background = rounded(Color.WHITE, 14f)
            clipToOutline = true
        }
        frame.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        add(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        if (tv) {
            val row = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val h = dp(42f)
            fun addBtn(v: View) {
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, h)
                if (row.childCount > 0) lp.leftMargin = dp(10f)
                row.addView(v, lp)
            }
            var first: View? = null
            if (relay != null && texts.phone != null) {
                val b = button(texts.phone, primary = true) { askPhone() }
                addBtn(b)
                first = b
            }
            if (texts.remote != null) {
                val b = button(texts.remote, primary = false) { web.requestFocus(View.FOCUS_DOWN) }
                remoteBtn = b
                addBtn(b)
                if (first == null) first = b
            }
            val c = button(texts.cancel, primary = false) { cancel() }
            addBtn(c)
            if (first == null) first = c
            val hint = label("", 12f, MUTED).apply { setPadding(dp(8f), 0, 0, 0) }
            hintView = hint
            row.addView(hint, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            add(row)
            val phone = relay?.phone()
            setHint(if (relay == null) null else if (phone != null) texts.hint?.replace("%s", phone) else texts.noPhone)
            first?.post { first.requestFocus() }
        } else {
            texts.note?.let { add(label(it, 12f, MUTED)) }
            add(button(texts.cancel, primary = false) { cancel() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48f)))
        }
        d.setContentView(box)
        d.setCancelable(true)
        d.setCanceledOnTouchOutside(false)
        d.setOnCancelListener { cancel() }
        d.setOnDismissListener { cancel() }
        d.setOnKeyListener { _, code, ev ->
            // Back inside the page returns to the buttons; Back on the buttons closes the check
            if (tv && code == KeyEvent.KEYCODE_BACK && web.hasFocus()) {
                if (ev.action == KeyEvent.ACTION_UP) (remoteBtn ?: box).requestFocus()
                true
            } else {
                false
            }
        }
        val dm = activity.resources.displayMetrics
        d.window?.let { w ->
            w.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            if (tv) {
                w.setLayout((dm.widthPixels * 0.78f).toInt(), (dm.heightPixels * 0.8f).toInt())
                w.setGravity(Gravity.CENTER)
                w.setDimAmount(0.7f)
            } else {
                w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, (dm.heightPixels * 0.76f).toInt())
                w.setGravity(Gravity.BOTTOM)
                w.setDimAmount(0.6f)
            }
        }
        return d
    }

    companion object {
        const val POLL_MS = 500L
        const val GATE_WAIT_MS = 25_000L
        /** A check left open this long is closed as cancelled (the WebView and the gate are not held forever). */
        const val MAX_OPEN_MS = 5L * 60 * 1000

        private val SHEET = Color.parseColor("#181B22")
        private val TEXT = Color.parseColor("#E8EAF0")
        private val MUTED = Color.parseColor("#9AA1B2")
        private val BUTTON = Color.parseColor("#252A35")
        private val ACCENT = Color.parseColor("#F5B700")
        private val DARK = Color.parseColor("#0F1115")
        private val HANDLE = Color.parseColor("#3A3F4B")
    }
}
