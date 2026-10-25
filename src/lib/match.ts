const STOP_WORDS = new Set([
  "a",
  "amp",
  "and",
  "audio",
  "by",
  "edit",
  "feat",
  "ft",
  "for",
  "in",
  "lyrics",
  "me",
  "music",
  "of",
  "official",
  "on",
  "prod",
  "remix",
  "the",
  "to",
  "topic",
  "version",
  "video",
  "with",
]);

function normalize(value: string): string {
  return (value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

function textScore(expected: string, actual: string): number {
  const left = normalize(expected);
  const right = normalize(actual);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 1;

  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) common += 1;
  }
  return common / Math.min(leftTokens.size, rightTokens.size);
}

interface MatchTarget {
  artist: string;
  title: string;
  durationMs?: number;
}

export function candidateScore(
  expected: MatchTarget,
  candidate: MatchTarget,
): number {
  const title = textScore(expected.title, candidate.title);
  const artist = textScore(expected.artist, candidate.artist);
  let score = title * 0.6 + artist * 0.4;

  if (
    expected.durationMs &&
    candidate.durationMs &&
    expected.durationMs > 0 &&
    candidate.durationMs > 0
  ) {
    const difference = Math.abs(expected.durationMs - candidate.durationMs);
    if (difference <= 4000) score += 0.08;
    else if (difference > 20000) score -= 0.08;
  }

  return score;
}

export function isRelevantCandidate(
  expected: MatchTarget,
  candidate: MatchTarget,
): boolean {
  const title = textScore(expected.title, candidate.title);
  const artist = textScore(expected.artist, candidate.artist);
  return title >= 0.55 || (artist >= 0.75 && title >= 0.3);
}

export function pickBestCandidate<T extends MatchTarget>(
  expected: MatchTarget,
  candidates: T[],
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (!isRelevantCandidate(expected, candidate)) continue;
    const score = candidateScore(expected, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
