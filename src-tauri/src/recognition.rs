use crate::models::RecognitionResult;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const TARGET_RATE: u32 = 16_000;
const CAPTURE_SECONDS: u64 = 12;

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
    api_token: String,
    source: Option<String>,
) -> Result<RecognitionResult, String> {
    let token = api_token.trim().to_string();
    if token.is_empty() {
        return Err("Укажите API-ключ AudD в настройках".to_string());
    }
    let source = RecognitionSource::parse(source.as_deref());
    #[cfg(target_os = "android")]
    if source == RecognitionSource::System {
        let path = crate::commands::android_capture_system_audio(&app).await?;
        let result = recognize_audd_file(path.clone(), token).await;
        let _ = tokio::fs::remove_file(&path).await;
        return result;
    }
    let samples = capture_16k(&app, source, CAPTURE_SECONDS).await?;
    let wav = tauri::async_runtime::spawn_blocking(move || wav_bytes(&samples))
        .await
        .map_err(|error| format!("Не удалось подготовить WAV: {error}"))??;

    audd_send(wav, "nova-sample.wav", "audio/wav", &token).await
}

/// AudD accepts common audio files, so the Android file picker can recognize a
/// track without the (Windows-only) local Shazam fingerprint engine.
pub async fn recognize_audd_file(
    path: String,
    api_token: String,
) -> Result<RecognitionResult, String> {
    let token = api_token.trim().to_string();
    if token.is_empty() {
        return Err("Укажите API-ключ AudD в настройках".to_string());
    }
    let name = std::path::Path::new(&path)
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
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|error| format!("Не удалось прочитать файл: {error}"))?;
    const MAX_AUDD_BYTES: u64 = 10 * 1024 * 1024;
    if metadata.len() > MAX_AUDD_BYTES {
        return Err(format!(
            "Файл больше 10 МБ ({}). AudD принимает файл до 10 МБ: выберите короткий фрагмент или mp3 меньшего размера.",
            metadata.len()
        ));
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|error| format!("Не удалось прочитать файл: {error}"))?;
    audd_send(bytes, &name, mime, &token).await
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
        return Err(message.to_string());
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
    fn level_mapping_is_bounded() {
        assert_eq!(normalized_level(0.0), 0.0);
        assert!((0.0..=1.0).contains(&normalized_level(0.1)));
    }
}
