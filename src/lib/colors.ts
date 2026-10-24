export interface CoverTheme {
  background: string;
  ink: string;
  accent: string;
}

const THEMES: CoverTheme[] = [
  { background: "#1C1710", ink: "#F3ECDD", accent: "#D9A441" },
  { background: "#0F1A2E", ink: "#E9EEF8", accent: "#5B8CFF" },
  { background: "#1E1010", ink: "#F2E3DC", accent: "#C2564B" },
  { background: "#D8D1C1", ink: "#191817", accent: "#8B5E3C" },
  { background: "#101A14", ink: "#E4EFE5", accent: "#6E9E78" },
  { background: "#1A111C", ink: "#F0E4F2", accent: "#A477A8" },
  { background: "#1A1A1D", ink: "#F1EEE7", accent: "#B9B4AA" },
];

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function coverTheme(seed: string): CoverTheme {
  return THEMES[hashString(seed) % THEMES.length];
}
