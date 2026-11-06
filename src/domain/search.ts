import { fail, ok, type Result } from './errors';
import { pathOf, type FsState } from './fs';
import { LIMITS } from './limits';

export interface SearchOptions {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export interface SearchHit {
  readonly fileId: string;
  readonly path: string;
  /** 1-based line number */
  readonly line: number;
  /** 0-based offsets inside `preview` */
  readonly start: number;
  readonly end: number;
  readonly preview: string;
}

export interface SearchOutcome {
  readonly hits: readonly SearchHit[];
  readonly truncated: boolean;
  readonly filesMatched: number;
}

const TIME_BUDGET_MS = 1500;
const MAX_SCANNED_LINE = 5000;
const CONTEXT_BEFORE = 60;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compilePattern(options: SearchOptions): Result<RegExp> {
  const source = options.regex ? options.query : escapeRegex(options.query);
  const wrapped = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return ok(new RegExp(wrapped, options.caseSensitive ? 'g' : 'gi'));
  } catch (cause) {
    return fail('INVALID_REGEX', 'That regular expression is not valid.', cause instanceof Error ? cause.message : '');
  }
}

function windowAround(line: string, start: number, end: number): { preview: string; start: number; end: number } {
  const from = Math.max(0, start - CONTEXT_BEFORE);
  const preview = line.slice(from, from + LIMITS.maxSearchLineChars);
  return { preview, start: start - from, end: Math.min(end - from, preview.length) };
}

function scanLine(line: string, pattern: RegExp): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = [];
  const text = line.length > MAX_SCANNED_LINE ? line.slice(0, MAX_SCANNED_LINE) : line;
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    } else {
      found.push({ start: match.index, end: match.index + match[0].length });
    }
    if (pattern.lastIndex > text.length) break;
    match = pattern.exec(text);
  }
  return found;
}

interface Scan {
  readonly hits: SearchHit[];
  readonly matched: Set<string>;
  readonly pattern: RegExp;
  readonly now: () => number;
  readonly deadline: number;
}

/** Scans one file into `scan`. Returns true when a limit (result count or time) stopped the search. */
function scanFile(scan: Scan, fileId: string, path: string, content: string): boolean {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    for (const m of scanLine(line, scan.pattern)) {
      if (scan.hits.length >= LIMITS.maxSearchResults) return true;
      scan.matched.add(fileId);
      scan.hits.push({ fileId, path, line: i + 1, ...windowAround(line, m.start, m.end) });
    }
    if (scan.now() > scan.deadline) return true;
  }
  return false;
}

export function searchWorkspace(
  state: FsState,
  options: SearchOptions,
  now: () => number = () => performance.now()
): Result<SearchOutcome> {
  if (options.query === '') return ok({ hits: [], truncated: false, filesMatched: 0 });
  const pattern = compilePattern(options);
  if (!pattern.ok) return pattern;
  const files = Object.values(state)
    .filter(n => n.kind === 'file')
    .map(n => ({ node: n, path: pathOf(state, n.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const scan: Scan = { hits: [], matched: new Set(), pattern: pattern.value, now, deadline: now() + TIME_BUDGET_MS };
  for (const { node, path } of files) {
    if (scanFile(scan, node.id, path, node.content)) {
      return ok({ hits: scan.hits, truncated: true, filesMatched: scan.matched.size });
    }
  }
  return ok({ hits: scan.hits, truncated: false, filesMatched: scan.matched.size });
}
