package com.spacesarmat.omp.player

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View

/** Chapter ticks over the progress bar of the native player (mockup: 4 px wide, light, taller than the bar). */
class ChapterTicksView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFE8EAF0.toInt() }
    private var ticks = FloatArray(0)

    /** Positions 0..1 along the bar. */
    fun setTicks(t: FloatArray) {
        if (t.contentEquals(ticks)) return
        ticks = t
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (ticks.isEmpty()) return
        val w = 3f * resources.displayMetrics.density
        val r = w / 2
        for (t in ticks) {
            val x = (t * width).coerceIn(r, width - r)
            canvas.drawRoundRect(x - r, 0f, x + r, height.toFloat(), r, r, paint)
        }
    }
}
