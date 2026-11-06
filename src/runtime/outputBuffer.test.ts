import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputBuffer, type BufferedLine } from './outputBuffer';

describe('OutputBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers thousands of pushes as a single batch', () => {
    const batches: Array<{ lines: readonly BufferedLine[]; chars: number }> = [];
    const buffer = new OutputBuffer((lines, chars) => batches.push({ lines, chars }), 50);
    for (let i = 0; i < 5000; i++) buffer.push({ level: 'log', text: `line ${i}` });
    expect(batches).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.lines).toHaveLength(5000);
    const expected = Array.from({ length: 5000 }, (_, i) => `line ${i}`.length).reduce((a, b) => a + b, 0);
    expect(batches[0]?.chars).toBe(expected);
  });

  it('flush() delivers immediately, keeps order, and is a no-op when empty', () => {
    const seen: string[] = [];
    const buffer = new OutputBuffer(lines => lines.forEach(l => seen.push(l.text)), 50);
    buffer.flush();
    buffer.push({ level: 'log', text: 'a' });
    buffer.push({ level: 'warn', text: 'b' });
    buffer.flush();
    expect(seen).toEqual(['a', 'b']);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual(['a', 'b']);
  });

  it('starts a new batch after a flush', () => {
    const sizes: number[] = [];
    const buffer = new OutputBuffer(lines => sizes.push(lines.length), 10);
    buffer.push({ level: 'log', text: 'x' });
    vi.advanceTimersByTime(10);
    buffer.push({ level: 'log', text: 'y' });
    buffer.push({ level: 'log', text: 'z' });
    vi.advanceTimersByTime(10);
    expect(sizes).toEqual([1, 2]);
  });
});
