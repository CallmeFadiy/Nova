package app.nova.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NovaStorageTest {
    @Test
    fun primaryMusic() {
        assertEquals(
            "/storage/emulated/0/Music",
            treeDocumentIdToPath("primary:Music", "/storage/emulated/0"),
        )
    }

    @Test
    fun primaryRoot() {
        assertEquals("/storage/emulated/0", treeDocumentIdToPath("primary:", "/storage/emulated/0"))
    }

    @Test
    fun sdCard() {
        assertEquals("/storage/1234-ABCD/Music", treeDocumentIdToPath("1234-ABCD:Music", "/storage/emulated/0"))
    }

    @Test
    fun malformed() {
        assertNull(treeDocumentIdToPath("primary", "/storage/emulated/0"))
    }
}
