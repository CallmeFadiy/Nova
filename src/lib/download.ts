/** URLs that `download_direct` (Rust HTTP) handles instead of yt-dlp. */
const AUDIO_HINTS = [
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wav",
  ".flac",
  ".webm",
];
const DIRECT_SOURCE =
  /zaycev\.net\/pages\/|muzofond\.fm\/|drivemusic\.me\//i;

/**
 * Mirrors `is_direct_source`/`is_audio_url` in `media.rs`: these downloads run
 * in Rust instead of yt-dlp. The native queue worker can cancel them with a
 * token, but the legacy Downloads/Import loop still hides its cancel button
 * until Task 4 switches the UI to the native queue.
 */
export function isDirectDownloadUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    AUDIO_HINTS.some((extension) => lower.includes(extension)) ||
    DIRECT_SOURCE.test(url)
  );
}
