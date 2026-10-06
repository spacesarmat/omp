package com.spacesarmat.omp.control

/**
 * The name this TV gives itself on the network (NSD and /omp/info), friendliest first:
 * Settings → device name; else maker + model when the maker is the box's brand, not the chip vendor
 * (a Dune HD box says MANUFACTURER=Realtek, MODEL=tv175v); else brand + model; else the model alone.
 */
object TvName {
    private val CHIP_VENDORS = setOf("realtek", "amlogic", "rockchip", "allwinner", "mediatek", "unknown")

    fun choose(deviceName: String?, manufacturer: String?, brand: String?, model: String?): String {
        val set = deviceName.orEmpty().trim()
        if (set.isNotEmpty()) return set
        val m = model.orEmpty().trim()
        val maker = manufacturer.orEmpty().trim()
        if (maker.isNotEmpty() && maker.lowercase() !in CHIP_VENDORS) return join(maker, m)
        val b = brand.orEmpty().trim()
        if (b.isNotEmpty() && b.lowercase() !in CHIP_VENDORS) return join(b, m)
        return m.ifEmpty { "Android TV" }
    }

    /** «Philips 55PUS7» from «philips» + «55PUS7»; the model alone when it already starts with the maker. */
    private fun join(maker: String, model: String): String {
        if (model.isEmpty()) return maker.replaceFirstChar { it.uppercase() }
        if (model.startsWith(maker, ignoreCase = true)) return model
        return maker.replaceFirstChar { it.uppercase() } + " " + model
    }
}
