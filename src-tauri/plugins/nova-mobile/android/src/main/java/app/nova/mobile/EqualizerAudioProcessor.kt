package app.nova.mobile

import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

data class NovaEqSettings(
    val enabled: Boolean = false,
    val bands: DoubleArray = DoubleArray(10),
    val preamp: Double = 0.0,
)

class EqualizerAudioProcessor : BaseAudioProcessor() {
    private val frequencies = doubleArrayOf(
        31.0, 62.0, 125.0, 250.0, 500.0,
        1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
    )
    private val q = 1.1
    @Volatile
    private var settings = NovaEqSettings()
    private var sampleRate = 44100
    private var channelCount = 2
    private var pcm16 = true
    private var filters: Array<Array<Biquad>> = emptyArray()

    fun update(enabled: Boolean, bands: Array<Double>, preamp: Double) {
        settings = NovaEqSettings(
            enabled = enabled,
            bands = DoubleArray(10) { bands.getOrElse(it) { 0.0 } },
            preamp = preamp,
        )
    }

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        sampleRate = inputAudioFormat.sampleRate
        channelCount = inputAudioFormat.channelCount.coerceAtLeast(1)
        pcm16 = inputAudioFormat.encoding == androidx.media3.common.C.ENCODING_PCM_16BIT
        filters = Array(channelCount) { Array(frequencies.size) { Biquad() } }
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val bytes = inputBuffer.remaining()
        if (bytes == 0) {
            replaceOutputBuffer(0).position(0)
            return
        }
        val output = replaceOutputBuffer(bytes)
        val config = settings
        if (!config.enabled || !pcm16 || channelCount <= 0 || filters.isEmpty()) {
            output.put(inputBuffer)
            output.position(bytes)
            inputBuffer.position(inputBuffer.limit())
            return
        }

        val inputShorts = inputBuffer.order(ByteOrder.nativeOrder()).asShortBuffer()
        val outputShorts = output.order(ByteOrder.nativeOrder()).asShortBuffer()
        val sampleCount = inputShorts.remaining()
        val preamp = 10.0.pow(config.preamp / 20.0)
        val maxFrequency = sampleRate * 0.45
        val coefficients = Array(frequencies.size) { index ->
            BiquadCoefficients.peaking(
                frequencies[index].coerceAtMost(maxFrequency),
                config.bands[index],
                q,
                sampleRate,
            )
        }
        for (channel in 0 until channelCount) {
            for (band in frequencies.indices) {
                filters[channel][band].set(coefficients[band])
            }
        }

        var index = 0
        while (index < sampleCount) {
            for (channel in 0 until channelCount) {
                if (index >= sampleCount) break
                var sample = inputShorts.get(index) / 32768.0
                sample *= preamp
                for (band in frequencies.indices) {
                    sample = filters[channel][band].process(sample)
                }
                val clamped = sample.coerceIn(-1.0, 1.0)
                outputShorts.put(index, (clamped * 32767.0).toInt().toShort())
                index += 1
            }
        }
        output.position(bytes)
        inputBuffer.position(inputBuffer.limit())
    }

    override fun onFlush() {
        filters.forEach { channel -> channel.forEach { it.reset() } }
    }

    private class Biquad {
        private var b0 = 1.0
        private var b1 = 0.0
        private var b2 = 0.0
        private var a1 = 0.0
        private var a2 = 0.0
        private var z1 = 0.0
        private var z2 = 0.0

        fun set(coefficients: BiquadCoefficients) {
            b0 = coefficients.b0
            b1 = coefficients.b1
            b2 = coefficients.b2
            a1 = coefficients.a1
            a2 = coefficients.a2
        }

        fun process(input: Double): Double {
            val output = b0 * input + z1
            z1 = b1 * input - a1 * output + z2
            z2 = b2 * input - a2 * output
            return output
        }

        fun reset() {
            z1 = 0.0
            z2 = 0.0
        }
    }

    private data class BiquadCoefficients(
        val b0: Double,
        val b1: Double,
        val b2: Double,
        val a1: Double,
        val a2: Double,
    ) {
        companion object {
            fun peaking(
                frequency: Double,
                gainDb: Double,
                q: Double,
                sampleRate: Int,
            ): BiquadCoefficients {
                val a = 10.0.pow(gainDb / 40.0)
                val omega = 2.0 * PI * frequency / sampleRate
                val alpha = sin(omega) / (2.0 * q)
                val cosOmega = cos(omega)
                val b0 = 1.0 + alpha * a
                val b1 = -2.0 * cosOmega
                val b2 = 1.0 - alpha * a
                val a0 = 1.0 + alpha / a
                val a1 = -2.0 * cosOmega
                val a2 = 1.0 - alpha / a
                return BiquadCoefficients(
                    b0 / a0,
                    b1 / a0,
                    b2 / a0,
                    a1 / a0,
                    a2 / a0,
                )
            }
        }
    }
}

object NovaEq {
    val processor = EqualizerAudioProcessor()

    fun update(enabled: Boolean, bands: Array<Double>, preamp: Double) {
        processor.update(enabled, bands, preamp)
    }
}
