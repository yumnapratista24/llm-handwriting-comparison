export const VERBATIM_NGRAM_SIZE = 8;

export interface VerbatimResult {
  contaminated: boolean;
  longestRun: number;
  n: number;
}

export function normalizeWords(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^0-9a-zÀ-ɏḀ-ỿ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

export function longestSharedWordRun(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

export function checkVerbatimOverlap(
  candidate: string,
  reference: string | null | undefined,
  n: number = VERBATIM_NGRAM_SIZE,
): VerbatimResult {
  const ref = reference ?? "";
  if (!ref.trim() || !candidate.trim()) {
    return { contaminated: false, longestRun: 0, n };
  }
  const longestRun = longestSharedWordRun(normalizeWords(candidate), normalizeWords(ref));
  return { contaminated: longestRun >= n, longestRun, n };
}
