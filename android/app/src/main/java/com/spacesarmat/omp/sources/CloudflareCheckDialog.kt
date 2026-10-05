package com.spacesarmat.omp.sources

import android.app.Activity
import android.app.Dialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
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
    /** No phone is paired with this TV. */
    val noPhone: String?,
    /** A phone is paired but OMP is not open on it. */
    val phoneClosed: String?,
    val waiting: String?,
    /** Another check holds the WebView: shown while the dialog waits for it. */
    val gateWait: String?,
    /** By [com.spacesarmat.omp.control.CloudflareRelay.Outcome] name: what the hint says when the phone did not pass it. */
    val errors: Map<String, String>,
    /** The login page tried to leave the site (it is back on the login page). */
    val blocked: String? = null,
    /** Browser login: while the sign-in is being checked. */
    val checking: String? = null,
    /** Browser login: the cookies did not open the site signed in. */
    val notConfirmed: String? = null,
    /** Browser login: the button that checks again. */
    val retry: String? = null,
)

/** How the visible check ended. [sent]: the phone passed it for the TV and the TV took the answer. */
class CheckResult(val result: String, val sent: Boolean? = null, val via: String? = null, val host: String? = null)

/**
 * The screen of the visible Cloudflare check ([VisibleCheck] is the logic): a bottom sheet on the phone (title, text,
 * the page, note, «Отмена»), a dialog under the remote on Android TV («Пройти на телефоне», «Отметить пультом» — focuses
 * the page; Back inside the page returns to the buttons —, «Отмена», hint). Main thread only.
 */
class CloudflareCheckDialog(
    private val activity: Activity,
    private val tv: Boolean,
    private val texts: CheckTexts,
    private val phoneButton: Boolean,
) : CheckUi {
    private var check: CheckControl? = null
    private var dialog: Dialog? = null
    private var frame: FrameLayout? = null
    private var hintView: TextView? = null
    private var remoteBtn: TextView? = null
    private var retryBtn: View? = null
    private var web: View? = null

    /** Builds and shows the dialog, then starts [c] on it. */
    fun show(c: CheckControl) {
        check = c
        val d = build()
        dialog = d
        d.show()
        c.start(this)
    }

    override fun showWaiting() {
        val f = frame ?: return
        f.removeAllViews()
        f.addView(
            label(texts.gateWait ?: "", 14f, DARK_MUTED).apply { gravity = Gravity.CENTER },
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
    }

    override fun showPage(browser: CloudflareBrowser) {
        val f = frame ?: return
        val v = (browser as? WebViewCloudflareBrowser)?.view ?: return
        web = v
        f.removeAllViews()
        f.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    override fun setHint(text: String?) {
        hintView?.let {
            it.text = text ?: ""
            it.visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }
    }

    override fun showRetry(show: Boolean) {
        retryBtn?.visibility = if (show) View.VISIBLE else View.GONE
    }

    override fun dismiss() {
        val d = dialog ?: return
        dialog = null
        // the page leaves the window before it is destroyed
        frame?.removeAllViews()
        d.setOnDismissListener(null)
        d.setOnCancelListener(null)
        try {
            d.dismiss()
        } catch (e: Throwable) {
            // the activity is gone
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

    private fun button(text: String, onClick: () -> Unit): TextView = TextView(activity).apply {
        this.text = text
        gravity = Gravity.CENTER
        typeface = Typeface.DEFAULT_BOLD
        isFocusable = true
        isClickable = true
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), rounded(ACCENT, 12f))
            addState(intArrayOf(android.R.attr.state_pressed), rounded(ACCENT, 12f))
            addState(intArrayOf(), rounded(BUTTON, 12f))
        }
        setTextColor(
            ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_focused), intArrayOf(android.R.attr.state_pressed), intArrayOf()),
                intArrayOf(DARK, DARK, TEXT),
            ),
        )
        setPadding(dp(20f), 0, dp(20f), 0)
        setOnClickListener { onClick() }
    }

    private fun build(): Dialog {
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
        val f = FrameLayout(activity).apply {
            background = rounded(Color.WHITE, 14f)
            clipToOutline = true
        }
        frame = f
        add(f, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
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
            if (phoneButton && texts.phone != null) {
                val b = button(texts.phone) { check?.askPhone() }
                addBtn(b)
                first = b
            }
            if (texts.remote != null) {
                val b = button(texts.remote) { web?.requestFocus(View.FOCUS_DOWN) }
                remoteBtn = b
                addBtn(b)
                if (first == null) first = b
            }
            texts.retry?.let {
                val b = button(it) { check?.retry() }.apply { visibility = View.GONE }
                retryBtn = b
                addBtn(b)
            }
            val c = button(texts.cancel) { check?.cancel() }
            addBtn(c)
            if (first == null) first = c
            val hint = label("", 12f, MUTED).apply {
                setPadding(dp(8f), 0, 0, 0)
                visibility = View.GONE
            }
            hintView = hint
            row.addView(hint, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            add(row)
            first?.post { first.requestFocus() }
        } else {
            texts.note?.let { add(label(it, 12f, MUTED)) }
            val hint = label("", 12f, ACCENT).apply { visibility = View.GONE }
            hintView = hint
            add(hint)
            texts.retry?.let {
                val b = button(it) { check?.retry() }.apply { visibility = View.GONE }
                retryBtn = b
                add(b, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48f)))
            }
            add(button(texts.cancel) { check?.cancel() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48f)))
        }
        d.setContentView(box)
        d.setCancelable(true)
        d.setCanceledOnTouchOutside(false)
        d.setOnCancelListener { check?.cancel() }
        d.setOnDismissListener { check?.cancel() }
        d.setOnKeyListener { _, code, ev ->
            // Back inside the page returns to the buttons; Back on the buttons closes the check
            if (tv && code == KeyEvent.KEYCODE_BACK && web?.hasFocus() == true) {
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
        private val SHEET = Color.parseColor("#181B22")
        private val TEXT = Color.parseColor("#E8EAF0")
        private val MUTED = Color.parseColor("#9AA1B2")
        private val DARK_MUTED = Color.parseColor("#59636E")
        private val BUTTON = Color.parseColor("#252A35")
        private val ACCENT = Color.parseColor("#F5B700")
        private val DARK = Color.parseColor("#0F1115")
        private val HANDLE = Color.parseColor("#3A3F4B")
    }
}
