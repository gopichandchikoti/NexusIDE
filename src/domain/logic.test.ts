import { describe, expect, it } from 'vitest';
import { fromEntries, type FsState } from './fs';
import { fuzzyMatch, rank } from './fuzzy';
import { extensionOf, isScriptSource, languageForPath, listLanguages } from './languages';
import { LIMITS } from './limits';
import { initialRunState, runReducer, elapsedMs, isBusy, type RunState } from './runState';
import { pickRunTarget } from './runTarget';
import { searchWorkspace, type SearchOptions } from './search';

const opts = (query: string, extra: Partial<SearchOptions> = {}): SearchOptions => ({
  query,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...extra,
});

function workspace(files: Record<string, string>): FsState {
  const r = fromEntries(Object.entries(files).map(([path, content]) => ({ path, kind: 'file' as const, content })));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe('languages', () => {
  it('maps extensions to runnability honestly', () => {
    expect(languageForPath('a/b/App.tsx')).toMatchObject({ id: 'typescript', runnable: 'script' });
    expect(languageForPath('index.html').runnable).toBe('preview');
    expect(languageForPath('main.py').runnable).toBe('none');
    expect(languageForPath('LICENSE').id).toBe('plaintext');
    expect(languageForPath('.gitignore').id).toBe('plaintext');
    expect(extensionOf('dir.v2/file')).toBe('');
    for (const odd of ['x.constructor', 'x.__proto__', 'x.toString', 'x.hasOwnProperty']) {
      expect(languageForPath(odd)).toMatchObject({ id: 'plaintext', runnable: 'none' });
    }
    expect(isScriptSource('x.mjs')).toBe(true);
    expect(listLanguages().length).toBeGreaterThan(8);
  });
});

describe('searchWorkspace', () => {
  const ws = workspace({ 'a.ts': 'const Foo = 1;\nfoo();\r\nfoobar', 'dir/b.md': 'FOO here' });

  it('finds matches across files with 1-based lines, ignoring case by default', () => {
    const r = searchWorkspace(ws, opts('foo'));
    expect(r.ok && r.value.hits.map(h => `${h.path}:${h.line}`)).toEqual(['a.ts:1', 'a.ts:2', 'a.ts:3', 'dir/b.md:1']);
    expect(r.ok && r.value.filesMatched).toBe(2);
  });

  it('supports case sensitivity and whole word', () => {
    const cs = searchWorkspace(ws, opts('foo', { caseSensitive: true }));
    expect(cs.ok && cs.value.hits).toHaveLength(2);
    const ww = searchWorkspace(ws, opts('foo', { wholeWord: true }));
    expect(ww.ok && ww.value.hits.map(h => h.line)).toEqual([1, 2, 1]);
  });

  it.each(['a*', '^', '(?:)', '$', '\\b', '(a|)'])('terminates on zero-length-capable regex %s', pattern => {
    const r = searchWorkspace(ws, opts(pattern, { regex: true }));
    expect(r.ok).toBe(true);
  });

  it('returns a structured error for an invalid regex and nothing for an empty query', () => {
    const bad = searchWorkspace(ws, opts('(', { regex: true }));
    expect(!bad.ok && bad.error.code).toBe('INVALID_REGEX');
    expect(searchWorkspace(ws, opts(''))).toEqual({ ok: true, value: { hits: [], truncated: false, filesMatched: 0 } });
  });

  it('treats regex metacharacters literally when regex is off', () => {
    const r = searchWorkspace(workspace({ 'x.txt': 'a.b a+b' }), opts('a+b'));
    expect(r.ok && r.value.hits).toHaveLength(1);
  });

  it('caps results and flags truncation', () => {
    const big = workspace({ 'big.txt': 'x\n'.repeat(LIMITS.maxSearchResults + 50) });
    const r = searchWorkspace(big, opts('x'));
    expect(r.ok && r.value.hits.length).toBe(LIMITS.maxSearchResults);
    expect(r.ok && r.value.truncated).toBe(true);
  });

  it('stops at the time budget instead of hanging', () => {
    let t = 0;
    const r = searchWorkspace(workspace({ 'a.txt': 'x\nx\nx' }), opts('x'), () => (t += 1000));
    expect(r.ok && r.value.truncated).toBe(true);
  });

  it('windows very long lines around the match', () => {
    const long = `${'a'.repeat(1000)}NEEDLE${'b'.repeat(1000)}`;
    const r = searchWorkspace(workspace({ 'l.txt': long }), opts('needle'));
    const hit = r.ok ? r.value.hits[0] : undefined;
    expect(hit?.preview.length).toBeLessThanOrEqual(LIMITS.maxSearchLineChars);
    expect(hit && hit.preview.slice(hit.start, hit.end)).toBe('NEEDLE');
  });
});

describe('fuzzy', () => {
  it('matches subsequences and rejects non-subsequences', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull();
    expect(fuzzyMatch('mts', 'src/main.ts')?.indices).toEqual([4, 9, 10]);
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
  });

  it('ranks prefix and word-start matches above scattered ones', () => {
    const items = ['src/components/Footer.tsx', 'foo.ts', 'a/b/c/f_o_o.ts'];
    const ranked = rank(items, 'foo', s => s).map(r => r.item);
    expect(ranked[0]).toBe('foo.ts');
    expect(ranked).toHaveLength(3);
  });

  it('keeps original order for an empty query and honours the limit', () => {
    expect(rank(['b', 'a', 'c'], '', s => s, 2).map(r => r.item)).toEqual(['b', 'a']);
  });
});

describe('pickRunTarget', () => {
  it('runs an html file as a preview', () => {
    expect(pickRunTarget('pages/x.html', ['pages/x.html'])).toEqual({
      ok: true,
      value: { mode: 'preview', entry: 'pages/x.html' },
    });
  });

  it('runs page scripts and styles through index.html', () => {
    const paths = ['index.html', 'app.js', 'style.css'];
    expect(pickRunTarget('app.js', paths)).toEqual({ ok: true, value: { mode: 'preview', entry: 'index.html' } });
    expect(pickRunTarget('style.css', paths)).toEqual({ ok: true, value: { mode: 'preview', entry: 'index.html' } });
  });

  it('runs a lone script as a console program', () => {
    expect(pickRunTarget('main.ts', ['main.ts'])).toEqual({ ok: true, value: { mode: 'script', entry: 'main.ts' } });
  });

  it('refuses unsupported languages with a clear message', () => {
    const r = pickRunTarget('main.py', ['main.py', 'index.html']);
    expect(!r.ok && r.error.code).toBe('UNSUPPORTED_RUNTIME');
    expect(!r.ok && r.error.message).toContain('Python');
  });

  it('chooses a default entry when nothing is active, or reports NO_ENTRY', () => {
    expect(pickRunTarget(null, ['src/main.tsx', 'index.html'])).toMatchObject({ value: { entry: 'index.html' } });
    expect(pickRunTarget(null, ['src/main.ts'])).toMatchObject({ value: { mode: 'script', entry: 'src/main.ts' } });
    const none = pickRunTarget(null, ['notes.md']);
    expect(!none.ok && none.error.code).toBe('NO_ENTRY');
  });
});

describe('runReducer', () => {
  const start = (s: RunState, runId = 1): RunState =>
    runReducer(s, { type: 'start', runId, mode: 'script', entry: 'a.ts', now: 100 });

  it('walks idle -> building -> running -> finished and tracks output', () => {
    let s = start(initialRunState);
    expect(s.phase).toBe('building');
    expect(isBusy(s)).toBe(true);
    s = runReducer(s, { type: 'built', runId: 1 });
    s = runReducer(s, { type: 'output', runId: 1, chars: 5 });
    s = runReducer(s, { type: 'finished', runId: 1, now: 400 });
    expect(s).toMatchObject({ phase: 'finished', messageCount: 1, outputChars: 5, endedAt: 400 });
    expect(elapsedMs(s, 9999)).toBe(300);
    expect(isBusy(s)).toBe(false);
  });

  it('ignores events from a stale run and does not revive finished runs', () => {
    let s = start(initialRunState, 2);
    s = runReducer(s, { type: 'failed', runId: 1, error: { code: 'BUILD_FAILED', message: 'x' }, now: 150 });
    expect(s.phase).toBe('building');
    s = runReducer(s, { type: 'stop', now: 200 });
    expect(s.phase).toBe('stopped');
    s = runReducer(s, { type: 'built', runId: 2 });
    s = runReducer(s, { type: 'finished', runId: 2, now: 300 });
    expect(s.phase).toBe('stopped');
  });

  it('records failure and timeout errors; reset keeps the run counter', () => {
    const failed = runReducer(start(initialRunState), {
      type: 'failed',
      runId: 1,
      error: { code: 'BUILD_FAILED', message: 'boom' },
      now: 120,
    });
    expect(failed).toMatchObject({ phase: 'failed', error: { message: 'boom' } });
    const timed = runReducer(start(initialRunState), { type: 'timeout', runId: 1, now: 500 });
    expect(timed).toMatchObject({ phase: 'timed-out', error: { code: 'TIMEOUT' } });
    expect(runReducer(timed, { type: 'reset' })).toMatchObject({ phase: 'idle', runId: 1 });
    expect(elapsedMs(initialRunState, 5)).toBe(0);
  });
});
