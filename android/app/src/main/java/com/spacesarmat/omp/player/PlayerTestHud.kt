package com.spacesarmat.omp.player

import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Corner codes for the native Android TV player. Drawn on top of a view (no extra layout space)
 * and not focusable, so the D-pad still lands on the control under the badge.
 * Shown only when the page asked for test mode and the installed version is `x.y.z-beta.N`
 * (a debug build's `-test` suffix does not count as stable).
 */
object PlayerTestHud {
    fun enabled(versionName: String, requested: Boolean): Boolean {
        if (!requested) return false
        val v = versionName.trim().removeSuffix("-test")
        return BETA.containsMatchIn(v)
    }

    private val BETA = Regex("-beta\\.[0-9]+$")

    class Pin(val view: View, val drawable: Drawable, val listener: View.OnLayoutChangeListener)

    class Session {
        val pins = ArrayList<Pin>()
        var copy: TextView? = null

        fun clear() {
            for (p in pins) {
                p.view.removeOnLayoutChangeListener(p.listener)
                p.view.overlay.remove(p.drawable)
            }
            pins.clear()
            val chip = copy
            copy = null
            (chip?.parent as? ViewGroup)?.removeView(chip)
        }
    }

    /** A code in the view's top-end corner. Touches pass through to the view. */
    fun pin(view: View, code: String, session: Session) {
        val d = CodeDrawable(view.context, code)
        val listener = View.OnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            d.setBounds(0, 0, v.width, v.height)
            v.invalidate()
        }
        view.addOnLayoutChangeListener(listener)
        d.setBounds(0, 0, view.width, view.height)
        view.overlay.add(d)
        session.pins.add(Pin(view, d, listener))
    }

    /** The screen code, top start. A tap copies it. Not focusable, so the remote skips it. */
    fun copyChip(ctx: Context, parent: FrameLayout, code: String, session: Session) {
        val chip = object : TextView(ctx) {
            override fun isFocusable(): Boolean = false
            override fun isFocusableInTouchMode(): Boolean = false
        }
        chip.text = code
        chip.setTextColor(Color.WHITE)
        chip.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 24f)
        chip.setBackgroundColor(0x8C000000.toInt())
        val pad = dip(ctx, 6f).toInt()
        chip.setPadding(pad, 0, pad, 0)
        chip.isClickable = true
        chip.isFocusable = false
        chip.isFocusableInTouchMode = false
        chip.setOnClickListener {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            cm?.setPrimaryClip(ClipData.newPlainText("code", code))
            Toast.makeText(ctx, code, Toast.LENGTH_SHORT).show()
        }
        val lp = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START)
        val m = dip(ctx, 16f).toInt()
        lp.topMargin = m
        lp.marginStart = m
        parent.addView(chip, lp)
        session.copy = chip
    }

    /** The dialog's own code, in the corner of its window. Not a focus target. */
    fun dialog(d: Dialog, code: String) {
        val decor = d.window?.decorView ?: return
        val drawable = CodeDrawable(decor.context, code)
        val listener = View.OnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            drawable.setBounds(0, 0, v.width, v.height)
            v.invalidate()
        }
        decor.addOnLayoutChangeListener(listener)
        drawable.setBounds(0, 0, decor.width, decor.height)
        decor.overlay.add(drawable)
    }

    private fun dip(ctx: Context, dp: Float): Float =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp, ctx.resources.displayMetrics)
}

/** Menu rows: the label stays the action, the code sits at the end and is not its own focus target. */
class CodedMenu(ctx: Context, private val rows: List<Pair<String, String>>) : ArrayAdapter<Pair<String, String>>(ctx, 0, rows) {
    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val row = getItem(position) ?: return View(context)
        val line = LinearLayout(context)
        line.orientation = LinearLayout.HORIZONTAL
        line.gravity = Gravity.CENTER_VERTICAL
        val pad = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 12f, context.resources.displayMetrics).toInt()
        line.setPadding(pad, pad, pad, pad)
        val label = TextView(context)
        label.text = row.first
        label.setTextColor(Color.WHITE)
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        label.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        val badge = TextView(context)
        badge.text = row.second
        badge.setTextColor(Color.WHITE)
        badge.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 24f)
        badge.setBackgroundColor(0x8C000000.toInt())
        badge.setPadding(pad / 2, 0, pad / 2, 0)
        badge.isFocusable = false
        badge.isClickable = false
        line.addView(label)
        line.addView(badge)
        return line
    }
}

private class CodeDrawable(ctx: Context, private val text: String) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 24f, ctx.resources.displayMetrics)
    }
    private val bg = Paint().apply { color = 0x8C000000.toInt() }
    private val pad = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 4f, ctx.resources.displayMetrics)

    override fun draw(canvas: Canvas) {
        val w = paint.measureText(text)
        val h = paint.textSize
        val right = bounds.right.toFloat()
        val top = bounds.top.toFloat()
        canvas.drawRect(right - w - pad * 2, top, right, top + h + pad, bg)
        canvas.drawText(text, right - w - pad, top + h, paint)
    }

    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {}
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
