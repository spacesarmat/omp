package com.spacesarmat.omp.control

/**
 * The name this TV gives itself on the network (NSD and /omp/info), friendliest first:
 * Settings → device name; else the vendor the caller recognised by an installed shell (`vendorHint`, «Dune HD» when
 * com.dunehd.shell is there: the Dune's build props name only the Realtek chip); else maker + model when the maker is the box's brand, not the chip vendor
 * (a Dune HD box says MANUFACTURER=Realtek, BRAND=rtk, MODEL=tv175v); else brand + model; else «Android TV (model)».
 * A device name that is just the model (the Dune sets device_name=tv175v itself) is not a name the user gave.
 */
object TvName {
    private val CHIP_VENDORS = setOf("realtek", "rtk", "amlogic", "rockchip", "allwinner", "mediatek", "unknown")

    const val DUNE_SHELL = "com.dunehd.shell"
    const val DUNE_NAME = "Dune HD"

    fun choose(deviceName: String?, manufacturer: String?, brand: String?, model: String?, vendorHint: String? = null): String {
        val m = model.orEmpty().trim()
        val set = deviceName.orEmpty().trim()
        if (set.isNotEmpty() && !set.equals(m, ignoreCase = true)) return set
        val hint = vendorHint.orEmpty().trim()
        if (hint.isNotEmpty()) return hint
        val maker = manufacturer.orEmpty().trim()
        if (maker.isNotEmpty() && maker.lowercase() !in CHIP_VENDORS) return join(maker, m)
        val b = brand.orEmpty().trim()
        if (b.isNotEmpty() && b.lowercase() !in CHIP_VENDORS) return join(b, m)
        return if (m.isEmpty()) "Android TV" else "Android TV ($m)"
    }

    /** «Philips 55PUS7» from «philips» + «55PUS7»; the model alone when it already starts with the maker. */
    private fun join(maker: String, model: String): String {
        if (model.isEmpty()) return maker.replaceFirstChar { it.uppercase() }
        if (model.startsWith(maker, ignoreCase = true)) return model
        return maker.replaceFirstChar { it.uppercase() } + " " + model
    }
}
