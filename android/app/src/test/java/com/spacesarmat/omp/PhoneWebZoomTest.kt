package com.spacesarmat.omp

import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneWebZoomTest {
    private class Fake : ZoomSwitches {
        val set = mutableMapOf<String, Boolean>()
        override fun setSupportZoom(on: Boolean) { set["support"] = on }
        override fun setBuiltInZoomControls(on: Boolean) { set["builtIn"] = on }
        override fun setDisplayZoomControls(on: Boolean) { set["display"] = on }
    }

    @Test
    fun turnsEveryZoomSwitchOff() {
        val f = Fake()
        PhoneWebZoom.disable(f)
        assertEquals(mapOf("support" to false, "builtIn" to false, "display" to false), f.set)
    }
}
