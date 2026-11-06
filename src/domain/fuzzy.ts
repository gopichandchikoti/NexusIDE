export interface FuzzyMatch {
  readonly score: number;
  /** Indices in the text that matched, for highlighting */
  readonly indices: readonly number[];
}

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1] as string;
  return prev === '/' || prev === ' ' || prev === '-' || prev === '_' || prev === '.' || prev === ':';
}

/** Subsequence match. Returns null when `query` is not a subsequence of `text`. Higher score = better. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (q === '') return { score: 0, indices: [] };
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at === -1) return null;
    score += 1;
    if (at === previous + 1) score += 4;
    if (isWordStart(t, at)) score += 3;
    if (at === 0) score += 3;
    indices.push(at);
    previous = at;
    from = at + 1;
  }
  const span = (indices[indices.length - 1] as number) - (indices[0] as number) + 1;
  score -= (span - q.length) * 0.25 + text.length * 0.01;
  if (t.includes(q)) score += 6;
  return { score, indices };
}

export interface Ranked<T> {
  readonly item: T;
  readonly match: FuzzyMatch;
}

export function rank<T>(items: readonly T[], query: string, textOf: (item: T) => string, limit = 50): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, textOf(item));
    if (match) out.push({ item, match });
  }
  if (query.trim() !== '') out.sort((a, b) => b.match.score - a.match.score);
  return out.slice(0, limit);
}
