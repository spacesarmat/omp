package com.spacesarmat.omp

/** Real Yandex units (R-M-...) and the two official native demo placements. */
internal object YandexAdsUnits {
    private val re = Regex("^(?:R-M-[0-9A-Za-z-]{1,40}|demo-native-content-yandex|demo-native-app-yandex)$")

    fun accept(raw: String?): Boolean {
        val s = raw?.trim() ?: return false
        return re.matches(s)
    }
}
