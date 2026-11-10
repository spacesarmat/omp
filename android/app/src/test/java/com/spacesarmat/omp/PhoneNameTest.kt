package com.spacesarmat.omp

import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneNameTest {
    @Test
    fun userNameWinsOverTheModelCode() {
        assertEquals("Гостиная", PhoneName.choose("Гостиная", "Galaxy S25 Ultra", "samsung", "SM-S938B"))
    }

    @Test
    fun marketingNameWhenTheUserNameIsJustTheCode() {
        assertEquals("Samsung Galaxy S25 Ultra", PhoneName.choose("SM-S938B", "Galaxy S25 Ultra", "samsung", "SM-S938B"))
        assertEquals("Samsung Galaxy S25 Ultra", PhoneName.choose("Samsung SM-S938B", "Galaxy S25 Ultra", "samsung", "SM-S938B"))
    }

    @Test
    fun modelCodeWhenNothingFriendlierIsKnown() {
        assertEquals("Samsung SM-S938B", PhoneName.choose("", "", "samsung", "SM-S938B"))
        assertEquals("Samsung SM-S938B", PhoneName.choose("Android", "unknown", "samsung", "SM-S938B"))
    }
}
