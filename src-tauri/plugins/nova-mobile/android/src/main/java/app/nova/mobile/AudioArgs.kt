package app.nova.mobile

import app.tauri.annotation.InvokeArg

@InvokeArg
class AudioItemArg {
    var id: Long = 0
    var uri: String = ""
    var title: String = ""
    var artist: String = ""
    var album: String = ""
    var artworkPath: String? = null
    var durationMs: Long = 0
}

@InvokeArg
class AudioQueueArgs {
    var items: Array<AudioItemArg> = emptyArray()
    var startIndex: Int = 0
    var positionMs: Long = 0
    var autoplay: Boolean = false
    var repeat: String = "off"
}

@InvokeArg
class AudioSeekArgs {
    var positionMs: Long = 0
}

@InvokeArg
class AudioVolumeArgs {
    var value: Double = 0.78
}

@InvokeArg
class AudioMutedArgs {
    var muted: Boolean = false
}

@InvokeArg
class AudioRepeatArgs {
    var mode: String = "off"
}
