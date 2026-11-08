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
 * in Rust and cannot be cancelled by the embedded yt-dlp plugin, so the UI must
 * not offer cancel for them.
 */
export function isDirectDownloadUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    AUDIO_HINTS.some((extension) => lower.includes(extension)) ||
    DIRECT_SOURCE.test(url)
  );
}
