package com.spacesarmat.omp.control

import org.junit.Assert.assertEquals
import org.junit.Test

class TvNameTest {
    @Test
    fun deviceNameFromSettingsWins() {
        assertEquals("Гостиная", TvName.choose(" Гостиная ", "Realtek", "Dune", "tv175v"))
    }

    @Test
    fun chipVendorMakerFallsBackToBrand() {
        assertEquals("Dune tv175v", TvName.choose(null, "Realtek", "Dune", "tv175v"))
        assertEquals("Ugoos AM6", TvName.choose("", "Amlogic", "ugoos", "AM6"))
        assertEquals("X96 Max", TvName.choose(null, "rockchip", "X96", "Max"))
    }

    @Test
    fun realMakerWithModel() {
        assertEquals("Xiaomi MiTV-AXSO0", TvName.choose(null, "Xiaomi", "Xiaomi", "MiTV-AXSO0"))
        assertEquals("NVIDIA SHIELD Android TV", TvName.choose(null, "NVIDIA", "NVIDIA", "SHIELD Android TV"))
        assertEquals("Sony BRAVIA 4K", TvName.choose("  ", "Sony", "Sony", "BRAVIA 4K"))
    }

    @Test
    fun noMakerNorBrandGivesTheModel() {
        assertEquals("tv175v", TvName.choose(null, "MediaTek", "Allwinner", "tv175v"))
        assertEquals("tv175v", TvName.choose(null, "", "", "tv175v"))
        assertEquals("Android TV", TvName.choose(null, null, null, null))
    }
}
