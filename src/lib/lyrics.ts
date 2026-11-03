export interface TimedLyricLine {
  id: string;
  timeMs: number | null;
  text: string;
}

const TIMESTAMP = /^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/;

function parseTime(minutes: string, seconds: string, fraction?: string): number {
  const minuteValue = Number(minutes) || 0;
  const secondValue = Number(seconds) || 0;
  const fractionValue = fraction
    ? Number(fraction.padEnd(3, "0").slice(0, 3))
    : 0;
  return minuteValue * 60_000 + secondValue * 1000 + fractionValue;
}

export function parseLyrics(text: string): TimedLyricLine[] {
  const normalized = text.replace(/\r/g, "");
  const lines = normalized.split("\n");
  return lines.map((line, index) => {
    const match = line.match(TIMESTAMP);
    if (!match) {
      return { id: `line-${index}`, timeMs: null, text: line.trim() };
    }
    return {
      id: `line-${index}`,
      timeMs: parseTime(match[1], match[2], match[3]),
      text: match[4].trim(),
    };
  });
}

export function formatLrcTimestamp(timeMs: number): string {
  const total = Math.max(0, Math.floor(timeMs));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const centiseconds = Math.floor((total % 1000) / 10);
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0",
  )}.${String(centiseconds).padStart(2, "0")}]`;
}

export function serializeLyrics(lines: TimedLyricLine[]): string {
  return lines
    .map((line) =>
      line.timeMs === null
        ? line.text
        : `${formatLrcTimestamp(line.timeMs)} ${line.text}`.trimEnd(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatOffset(offsetMs: number): string {
  const seconds = offsetMs / 1000;
  const sign = seconds > 0 ? "+" : "";
  return `${sign}${seconds.toFixed(1)} с`;
}

export function hasTimestamps(lines: TimedLyricLine[]): boolean {
  return lines.some((line) => line.timeMs !== null);
}
