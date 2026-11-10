use crate::models::RecognitionResult;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::{AppHandle, Emitter};

const TARGET_RATE: u32 = 16_000;
const CAPTURE_SECONDS: u64 = 12;

// The AudD token is bundled with the application and is not editable from the
// UI. Treat it as extractable from the APK rather than as a server-side secret.
const AUDD_API_TOKEN: &str = "501e0d08fc5f362e3bba3159c91ec152";

// AudD is temporarily disabled on Android. The implementation and key remain
// in the binary so it can be re-enabled without restoring the removed UI.
#[cfg(target_os = "android")]
const AUDD_ENABLED_ANDROID: bool = false;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecognitionSource {
    Microphone,
    System,
}

impl RecognitionSource {
    pub fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("microphone").to_lowercase().as_str() {
            "system" | "speakers" | "loopback" => Self::System,
            _ => Self::Microphone,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::System => "system",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecognitionLevel {
    level: f32,
    peak: f32,
    source: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn rms_and_peak(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let mut sum = 0.0f64;
    let mut peak = 0.0f32;
    for sample in samples {
        let value = *sample;
        sum += (value as f64) * (value as f64);
        peak = peak.max(value.abs());
    }
    (((sum / samples.len() as f64).sqrt()) as f32, peak)
}

fn normalized_level(rms: f32) -> f32 {
    if rms <= 1e-7 {
        return 0.0;
    }
    let db = 20.0 * rms.log10();
    ((db + 60.0) / 60.0).clamp(0.0, 1.0)
}

fn maybe_emit_level(
    app: &AppHandle,
    source: RecognitionSource,
    rms: f32,
    peak: f32,
    last_emit: &AtomicU64,
) {
    let now = now_ms();
    let previous = last_emit.load(Ordering::Relaxed);
    if now.saturating_sub(previous) < 50 {
        return;
    }
    last_emit.store(now, Ordering::Relaxed);
    let _ = app.emit(
        "recognition-level",
        RecognitionLevel {
            level: normalized_level(rms),
            peak: peak.clamp(0.0, 1.0),
            source: source.label().to_string(),
        },
    );
}

fn resample_to_16k(samples: &[f32], input_rate: u32) -> Vec<i16> {
    if samples.is_empty() {
        return Vec::new();
    }
    if input_rate == 0 {
        return Vec::new();
    }
    if input_rate == TARGET_RATE {
        return samples
            .iter()
            .map(|sample| (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
            .collect();
    }

    let ratio = input_rate as f64 / TARGET_RATE as f64;
    let output_len = ((samples.len() as f64) / ratio).floor() as usize;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let start = (index as f64 * ratio) as usize;
        let end = (((index + 1) as f64 * ratio) as usize)
            .min(samples.len())
            .max(start + 1);
        let slice = &samples[start.min(samples.len() - 1)..end.min(samples.len())];
        let average = if slice.is_empty() {
            0.0
        } else {
            slice.iter().sum::<f32>() / slice.len() as f32
        };
        output.push((average.clamp(-1.0, 1.0) * i16::MAX as f32) as i16);
    }
    output
}

async fn capture_16k(
    app: &AppHandle,
    source: RecognitionSource,
    seconds: u64,
) -> Result<Vec<i16>, String> {
    let app = app.clone();
    let (samples, rate) = tauri::async_runtime::spawn_blocking(move || match source {
        RecognitionSource::Microphone => capture_microphone(&app, seconds),
        RecognitionSource::System => capture_system(&app, seconds),
    })
    .await
    .map_err(|error| format!("Не удалось запустить захват звука: {error}"))??;

    let converted = resample_to_16k(&samples, rate);
    if converted.len() < 3 * TARGET_RATE as usize {
        return Err(format!(
            "Слишком короткая запись: {:.1} с. Нужно не меньше 3 секунд.",
            converted.len() as f32 / TARGET_RATE as f32
        ));
    }
    Ok(converted)
}

fn capture_microphone(app: &AppHandle, seconds: u64) -> Result<(Vec<f32>, u32), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "Микрофон не найден. Проверьте, что он подключён и разрешён.".to_string())?;
    let supported = device.default_input_config().map_err(|error| {
        format!(
            "Не удалось открыть микрофон «{}»: {error}",
            device.name().unwrap_or_default()
        )
    })?;
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let channels = config.channels as usize;
    let sample_rate = config.sample_rate.0;
    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
    let last_emit = Arc::new(AtomicU64::new(0));

    let stream = match sample_format {
        cpal::SampleFormat::I8 => build_mic_stream::<i8>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        cpal::SampleFormat::I16 => build_mic_stream::<i16>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        cpal::SampleFormat::I24 => build_mic_stream::<cpal::I24>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        cpal::SampleFormat::I32 => build_mic_stream::<i32>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        cpal::SampleFormat::I64 => build_mic_stream::<i64>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        cpal::SampleFormat::U8 => build_mic_stream::<u8>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        cpal::SampleFormat::U16 => build_mic_stream::<u16>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        cpal::SampleFormat::U32 => build_mic_stream::<u32>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        cpal::SampleFormat::U64 => build_mic_stream::<u64>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        cpal::SampleFormat::F32 => build_mic_stream::<f32>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        cpal::SampleFormat::F64 => build_mic_stream::<f64>(
            &device,
            &config,
            channels,
            app.clone(),
            samples.clone(),
            last_emit.clone(),
        )?,
        other => return Err(format!("Формат микрофона {other:?} не поддерживается")),
    };

    stream
        .play()
        .map_err(|error| format!("Не удалось включить микрофон: {error}"))?;
    std::thread::sleep(Duration::from_secs(seconds));
    drop(stream);

    let collected = samples
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    if collected.is_empty() {
        return Err("Микрофон не записал ни одного сэмпла".to_string());
    }
    Ok((collected, sample_rate))
}

fn build_mic_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    app: AppHandle,
    samples: Arc<Mutex<Vec<f32>>>,
    last_emit: Arc<AtomicU64>,
) -> Result<cpal::Stream, String>
where
    T: cpal::Sample + cpal::SizedSample + Send + 'static,
    f32: cpal::FromSample<T>,
{
    use cpal::traits::DeviceTrait;
    use cpal::Sample;

    let channels = channels.max(1);
    let app_error = app.clone();
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let mut mono = Vec::with_capacity(data.len() / channels);
                for frame in data.chunks(channels) {
                    let mut sum = 0.0f32;
                    for sample in frame {
                        sum += f32::from_sample(*sample);
                    }
                    mono.push(sum / frame.len() as f32);
                }
                let (rms, peak) = rms_and_peak(&mono);
                if let Ok(mut guard) = samples.lock() {
                    guard.extend_from_slice(&mono);
                }
                maybe_emit_level(&app, RecognitionSource::Microphone, rms, peak, &last_emit);
            },
            move |error| {
                let _ = app_error.emit(
                    "recognition-error",
                    format!("Ошибка микрофона: {error}"),
                );
            },
            None,
        )
        .map_err(|error| format!("Не удалось начать запись с микрофона: {error}"))
}

#[cfg(windows)]
fn capture_system(app: &AppHandle, seconds: u64) -> Result<(Vec<f32>, u32), String> {
    use wasapi::{
        initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
    };

    initialize_mta()
        .ok()
        .map_err(|error| format!("WASAPI: не удалось инициализировать COM: {error}"))?;
    let enumerator =
        DeviceEnumerator::new().map_err(|error| format!("WASAPI: {error}"))?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|error| format!("Не найден системный динамик: {error}"))?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|error| format!("WASAPI: {error}"))?;
    let mix_format = audio_client
        .get_mixformat()
        .map_err(|error| format!("WASAPI: не удалось узнать формат динамика: {error}"))?;
    let rate = mix_format.get_samplespersec();
    let channels = mix_format.get_nchannels() as usize;
    let desired_format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        rate as usize,
        channels,
        None,
    );
    let (default_period, _minimum_period) = audio_client
        .get_device_period()
        .map_err(|error| format!("WASAPI: {error}"))?;
    let mode = StreamMode::PollingShared {
        autoconvert: true,
        buffer_duration_hns: default_period,
    };
    audio_client
        .initialize_client(&desired_format, &Direction::Capture, &mode)
        .map_err(|error| {
            format!(
                "Не удалось включить захват системного звука: {error}. Проверьте устройство вывода Windows."
            )
        })?;
    let capture = audio_client
        .get_audiocaptureclient()
        .map_err(|error| format!("WASAPI: {error}"))?;
    audio_client
        .start_stream()
        .map_err(|error| format!("WASAPI: не удалось начать запись: {error}"))?;

    let bytes_per_frame = 4 * channels.max(1);
    let mut buffer = vec![0u8; bytes_per_frame * 2048];
    let started = Instant::now();
    let mut mono = Vec::<f32>::with_capacity(rate as usize * seconds as usize);
    let mut last_emit = 0u64;

    while started.elapsed() < Duration::from_secs(seconds) {
        let (frames, _info) = capture
            .read_from_device(&mut buffer)
            .map_err(|error| format!("WASAPI: ошибка чтения: {error}"))?;
        if frames == 0 {
            std::thread::sleep(Duration::from_millis(8));
            continue;
        }
        let byte_len = frames as usize * bytes_per_frame;
        for frame in buffer[..byte_len].chunks_exact(bytes_per_frame) {
            let mut sum = 0.0f32;
            for channel in 0..channels {
                let offset = channel * 4;
                let sample = f32::from_le_bytes([
                    frame[offset],
                    frame[offset + 1],
                    frame[offset + 2],
                    frame[offset + 3],
                ]);
                sum += sample;
            }
            mono.push(sum / channels as f32);
        }
        let (rms, peak) = rms_and_peak(&mono[mono.len().saturating_sub(4096)..]);
        let now = now_ms();
        if now.saturating_sub(last_emit) >= 50 {
            last_emit = now;
            let _ = app.emit(
                "recognition-level",
                RecognitionLevel {
                    level: normalized_level(rms),
                    peak: peak.clamp(0.0, 1.0),
                    source: "system".to_string(),
                },
            );
        }
        std::thread::sleep(Duration::from_millis(8));
    }

    audio_client
        .stop_stream()
        .map_err(|error| format!("WASAPI: не удалось остановить запись: {error}"))?;
    if mono.is_empty() {
        return Err("Системный звук не дал ни одного сэмпла".to_string());
    }
    Ok((mono, rate))
}

#[cfg(not(windows))]
fn capture_system(_app: &AppHandle, _seconds: u64) -> Result<(Vec<f32>, u32), String> {
    Err("Захват системного звука доступен только в Windows-версии Nova".to_string())
}

fn songrec_file(path: String) -> Result<RecognitionResult, String> {
    // `songrec-lib` uses a blocking reqwest client, which creates and drops its
    // own Tokio runtime. On Android that panics when it happens on a Tokio
    // worker/blocking thread ("event loop thread panicked"), so isolate the
    // library on a plain OS thread.
    std::thread::spawn(move || {
        let songrec = songrec::SongRec::new(songrec::Config::default());
        songrec
            .recognize_from_file(&path)
            .map(map_shazam_result)
            .map_err(|error| error.to_string())
    })
    .join()
    .map_err(|_| "Ошибка встроенного распознавания (songrec).".to_string())?
}

fn songrec_samples(samples: Vec<i16>) -> Result<RecognitionResult, String> {
    std::thread::spawn(move || {
        let songrec = songrec::SongRec::new(songrec::Config::default());
        songrec
            .recognize_from_samples(&samples, TARGET_RATE)
            .map(map_shazam_result)
            .map_err(|error| error.to_string())
    })
    .join()
    .map_err(|_| "Ошибка встроенного распознавания (songrec).".to_string())?
}

pub async fn recognize_shazam(
    app: AppHandle,
    source: Option<String>,
) -> Result<RecognitionResult, String> {
    #[cfg(target_os = "android")]
    {
        let _ = (app, source);
        return Err(
            "Встроенный Shazam доступен в Windows-версии. Выберите AudD в настройках."
                .to_string(),
        );
    }
    #[cfg(not(target_os = "android"))]
    {
        let source = RecognitionSource::parse(source.as_deref());
        let captured_app = app.clone();
        let samples = capture_16k(&captured_app, source, CAPTURE_SECONDS).await?;
        let usable_len = samples.len() / 128 * 128;
        let samples = samples[..usable_len].to_vec();
        tauri::async_runtime::spawn_blocking(move || songrec_samples(samples))
            .await
            .map_err(|error| format!("Ошибка распознавания: {error}"))?
    }
}

pub async fn recognize_shazam_file(path: String) -> Result<RecognitionResult, String> {
    #[cfg(target_os = "android")]
    {
        let _ = path;
        return Err(
            "Встроенный Shazam доступен в Windows-версии. Выберите AudD в настройках."
                .to_string(),
        );
    }
    #[cfg(not(target_os = "android"))]
    {
        tauri::async_runtime::spawn_blocking(move || songrec_file(path))
            .await
            .map_err(|error| format!("Ошибка чтения файла: {error}"))?
    }
}

pub async fn recognize_audd(
    app: AppHandle,
    source: Option<String>,
) -> Result<RecognitionResult, String> {
    #[cfg(target_os = "android")]
    if !AUDD_ENABLED_ANDROID {
        return Err("AudD временно отключён на Android".to_string());
    }
    let token = AUDD_API_TOKEN;
    let source = RecognitionSource::parse(source.as_deref());
    #[cfg(target_os = "android")]
    if source == RecognitionSource::System {
        let path = crate::commands::android_capture_system_audio(&app).await?;
        let result = recognize_audd_file(path.clone()).await;
        let _ = tokio::fs::remove_file(&path).await;
        return result;
    }
    let samples = capture_16k(&app, source, CAPTURE_SECONDS).await?;
    let wav = tauri::async_runtime::spawn_blocking(move || wav_bytes(&samples))
        .await
        .map_err(|error| format!("Не удалось подготовить WAV: {error}"))??;

    audd_send(wav, "nova-sample.wav", "audio/wav", token).await
}

/// Decode the first `seconds` of an audio file into a 16 kHz mono WAV. AudD's
/// standard endpoint analyzes ~12 s and caps uploads at 10 MB, so large tracks
/// are reduced before upload.
fn extract_preview(path: &str, seconds: u64) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Не удалось открыть файл: {error}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = Path::new(path).extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("Формат аудио не поддержан: {error}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "В файле нет аудиодорожки".to_string())?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("Кодек аудио не поддержан: {error}"))?;
    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(0);
    let limit_seconds = seconds.max(1);
    let mut mono: Vec<f32> = Vec::new();

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                if sample_rate == 0 {
                    sample_rate = spec.rate;
                }
                let channels = spec.channels.count().max(1);
                let mut buffer =
                    SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                buffer.copy_interleaved_ref(decoded);
                for frame in buffer.samples().chunks(channels) {
                    let sum: f32 = frame.iter().sum();
                    mono.push(sum / channels as f32);
                }
                if sample_rate > 0
                    && mono.len() as u64 >= sample_rate as u64 * limit_seconds
                {
                    break;
                }
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(_) => break,
        }
    }

    if mono.is_empty() || sample_rate == 0 {
        return Err("Не удалось декодировать аудио".to_string());
    }
    let limit = sample_rate as usize * limit_seconds as usize;
    if mono.len() > limit {
        mono.truncate(limit);
    }
    let samples = resample_to_16k(&mono, sample_rate);
    if samples.len() < TARGET_RATE as usize * 2 {
        return Err("Слишком короткая запись: нужно не меньше 2 секунд".to_string());
    }
    wav_bytes(&samples)
}

/// AudD accepts common audio files, so the Android file picker can recognize a
/// track without the (Windows-only) local Shazam fingerprint engine.
pub async fn recognize_audd_file(path: String) -> Result<RecognitionResult, String> {
    #[cfg(target_os = "android")]
    if !AUDD_ENABLED_ANDROID {
        return Err("AudD временно отключён на Android".to_string());
    }
    let token = AUDD_API_TOKEN;

    const MAX_AUDD_BYTES: u64 = 10 * 1024 * 1024;
    let size = tokio::fs::metadata(&path)
        .await
        .map_err(|error| format!("Не удалось прочитать файл: {error}"))?
        .len();

    // Small files are uploaded as-is: AudD can analyze the whole track, which is
    // more forgiving than a single 12-second window. Only files above AudD's
    // standard-endpoint cap are reduced to their first 12 seconds.
    if size > MAX_AUDD_BYTES {
        let preview_path = path.clone();
        let preview = tauri::async_runtime::spawn_blocking(move || {
            extract_preview(&preview_path, 12)
        })
        .await
        .map_err(|error| format!("Не удалось подготовить фрагмент: {error}"))?;
        return match preview {
            Ok(wav) => audd_send(wav, "nova-preview.wav", "audio/wav", token).await,
            Err(preview_error) => Err(format!(
                "{preview_error}. Файл больше 10 МБ ({:.1} МБ), отправлять целиком нельзя.",
                size as f64 / 1_048_576.0
            )),
        };
    }

    let name = Path::new(&path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "nova-sample.wav".to_string());
    let mime = match name.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "m4a" | "aac" | "mp4" => "audio/mp4",
        "webm" => "audio/webm",
        "wma" => "audio/x-ms-wma",
        "aiff" | "aif" => "audio/aiff",
        _ => "audio/wav",
    };
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|error| format!("Не удалось прочитать файл: {error}"))?;
    audd_send(bytes, &name, mime, token).await
}

async fn audd_send(
    bytes: Vec<u8>,
    file_name: &str,
    mime: &str,
    token: &str,
) -> Result<RecognitionResult, String> {
    let client = crate::http::client_builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| error.to_string())?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name.to_string())
        .mime_str(mime)
        .map_err(|error| error.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("api_token", token.to_string())
        .text("return", "apple_music,spotify")
        .part("file", part);

    let response = client
        .post("https://api.audd.io/")
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("AudD недоступен: {error}"))?;
    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("AudD вернул ошибку: {error}"))?;

    if json.get("status").and_then(|value| value.as_str()) != Some("success") {
        let message = json
            .get("error")
            .and_then(|value| value.get("error_message"))
            .and_then(|value| value.as_str())
            .unwrap_or("AudD не смог обработать запрос");
        let friendly = if message.contains("limit was reached") {
            "Лимит запросов AudD исчерпан. Проверьте тариф на dashboard.audd.io."
        } else if message.contains("authorization failed")
            || message.contains("api_token")
        {
            "AudD отклонил API-ключ. Проверьте ключ и тариф на dashboard.audd.io."
        } else {
            message
        };
        return Err(friendly.to_string());
    }

    let result = json.get("result").unwrap_or(&serde_json::Value::Null);
    if result.is_null() {
        return Err("Не удалось распознать трек. Попробуйте громче или ближе к источнику.".to_string());
    }

    let title = result
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or("Неизвестный трек")
        .to_string();
    let artist = result
        .get("artist")
        .and_then(|value| value.as_str())
        .unwrap_or("Неизвестный исполнитель")
        .to_string();
    let album = result
        .get("album")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();

    let artwork = result
        .get("apple_music")
        .and_then(|value| value.get("artwork"))
        .and_then(|value| value.get("url"))
        .and_then(|value| value.as_str())
        .map(|value| value.replace("{w}", "600").replace("{h}", "600"))
        .or_else(|| {
            result
                .get("spotify")
                .and_then(|value| value.get("album"))
                .and_then(|value| value.get("images"))
                .and_then(|value| value.as_array())
                .and_then(|images| images.first())
                .and_then(|image| image.get("url"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
        });

    let source_url = result
        .get("song_link")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| {
            result
                .get("spotify")
                .and_then(|value| value.get("external_urls"))
                .and_then(|value| value.get("spotify"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
        });

    Ok(RecognitionResult {
        title: title.clone(),
        artist: artist.clone(),
        album,
        artwork_url: artwork,
        source_url,
        query: format!("{artist} {title}"),
        provider: "AudD".to_string(),
    })
}

fn wav_bytes(samples: &[i16]) -> Result<Vec<u8>, String> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: TARGET_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|error| format!("Не удалось создать WAV: {error}"))?;
        for sample in samples {
            writer
                .write_sample(*sample)
                .map_err(|error| format!("Не удалось записать WAV: {error}"))?;
        }
        writer
            .finalize()
            .map_err(|error| format!("Не удалось завершить WAV: {error}"))?;
    }
    Ok(cursor.into_inner())
}

fn map_shazam_result(result: songrec::RecognitionResult) -> RecognitionResult {
    let raw = result
        .raw_response
        .get("track")
        .unwrap_or(&result.raw_response);
    let artwork = raw
        .get("images")
        .and_then(|value| value.get("coverart"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let source_url = raw
        .get("url")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| {
            raw.get("share")
                .and_then(|value| value.get("href"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
        });

    let query = format!("{} {}", result.artist_name, result.song_name);
    RecognitionResult {
        title: result.song_name,
        artist: result.artist_name,
        album: result.album_name.unwrap_or_default(),
        artwork_url: artwork,
        source_url,
        query,
        provider: "Shazam".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resamples_to_16khz() {
        let input = vec![0.1f32; 48_000];
        let output = resample_to_16k(&input, 48_000);
        assert_eq!(output.len(), 16_000);
        assert!(output.iter().any(|sample| *sample != 0));
    }

    #[test]
    fn keeps_sixteen_khz_input() {
        let input = vec![0.5f32; 16_000];
        let output = resample_to_16k(&input, 16_000);
        assert_eq!(output.len(), 16_000);
        assert_eq!(output[0], 16_383);
    }

    #[test]
    fn extract_preview_produces_16k_mono_wav() {
        let path = std::env::temp_dir().join(format!(
            "nova-preview-{}-{}.wav",
            std::process::id(),
            now_ms()
        ));
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 44_100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        {
            let mut writer = hound::WavWriter::create(&path, spec).unwrap();
            for index in 0..44_100 * 3 {
                let sample = ((index as f32 * 440.0 * 2.0 * std::f32::consts::PI / 44_100.0)
                    .sin()
                    * 6000.0) as i16;
                writer.write_sample(sample).unwrap();
            }
            writer.finalize().unwrap();
        }

        let wav = extract_preview(path.to_str().unwrap(), 2).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1);
        assert_eq!(
            u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]),
            16_000
        );
        let data_len =
            u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]) as usize;
        let duration_samples = data_len / 2;
        assert!(
            (31_000..=33_000).contains(&duration_samples),
            "unexpected preview duration: {duration_samples} samples"
        );
    }

    #[test]
    fn level_mapping_is_bounded() {
        assert_eq!(normalized_level(0.0), 0.0);
        assert!((0.0..=1.0).contains(&normalized_level(0.1)));
    }
}

