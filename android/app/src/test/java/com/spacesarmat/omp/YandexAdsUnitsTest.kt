package com.spacesarmat.omp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class YandexAdsUnitsTest {
    @Test
    fun acceptsDemoAndRealUnitsOnly() {
        assertTrue(YandexAdsUnits.accept("demo-native-content-yandex"))
        assertTrue(YandexAdsUnits.accept("demo-native-app-yandex"))
        assertTrue(YandexAdsUnits.accept("R-M-123456-1"))
        assertFalse(YandexAdsUnits.accept(""))
        assertFalse(YandexAdsUnits.accept("ca-app-pub-1"))
        assertFalse(YandexAdsUnits.accept(null))
    }
}
