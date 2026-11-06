// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@/domain/runState';
import type { HostMessage, SandboxEvent } from './protocol';
import type { RunnerDeps } from './runner';

interface FakeSandbox {
  posted: HostMessage[];
  destroyed: boolean;
  visible: boolean;
  emit: (event: SandboxEvent) => void;
}
const sandboxes: FakeSandbox[] = [];

vi.mock('./sandboxHost', () => ({
  createSandbox: (_mount: HTMLElement, onEvent: (e: SandboxEvent) => void, options: { visible: boolean }) => {
    const fake: FakeSandbox = { posted: [], destroyed: false, visible: options.visible, emit: onEvent };
    sandboxes.push(fake);
    return {
      frame: {},
      post: (m: HostMessage) => fake.posted.push(m),
      destroy: () => {
        fake.destroyed = true;
      },
    };
  },
}));

const { MAX_BOOT_RETRIES_AFTER_STALL, MAX_MESSAGES_PER_RUN, Runner } = await import('./runner');

let events: RunEvent[];
let lines: Array<{ level: string; text: string }>;
let previewMount: HTMLElement | null;
let timeoutMs: number;

function makeRunner(): InstanceType<typeof Runner> {
  const deps: RunnerDeps = {
    previewMount: () => previewMount,
    hiddenMount: () => document.body,
    timeoutMs: () => timeoutMs,
    emit: e => events.push(e),
    log: (level, text) => lines.push({ level, text }),
    logMany: batch => batch.forEach(l => lines.push({ level: l.level, text: l.text })),
    now: () => Date.now(),
  };
  return new Runner(deps);
}
const types = () => events.map(e => e.type);
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  sandboxes.length = 0;
  events = [];
  lines = [];
  previewMount = document.createElement('div');
  timeoutMs = 3000;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Runner (page preview)', () => {
  it('cancels a build when Stop is pressed before the sandbox is created', async () => {
    const runner = makeRunner();
    const pending = runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p>cancelled</p>' });

    runner.stop();
    await pending;

    expect(sandboxes).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'stop' });
    expect(runner.active).toBe(false);
  });

  it('builds the document, starts a visible sandbox, and batches output into one update', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p>hi</p>' });
    expect(types()).toEqual(['start', 'built']);
    expect(sandboxes).toHaveLength(1);
    expect(sandboxes[0]?.visible).toBe(true);
    expect(sandboxes[0]?.posted[0]).toMatchObject({ type: 'run-document' });
    sandboxes[0]?.emit({ type: 'ready' });
    for (let i = 0; i < 3; i++) sandboxes[0]?.emit({ type: 'console', level: 'log', text: `line ${i}` });
    expect(lines.filter(l => l.text.startsWith('line'))).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60);
    expect(lines.filter(l => l.text.startsWith('line')).map(l => l.text)).toEqual(['line 0', 'line 1', 'line 2']);
    expect(events.filter(e => e.type === 'output')).toEqual([{ type: 'output', runId: 1, chars: 18, count: 3 }]);
    expect(runner.active).toBe(true);
  });

  it('caps output per run and drops the rest with one notice', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    sandboxes[0]?.emit({ type: 'ready' });
    for (let i = 0; i < MAX_MESSAGES_PER_RUN + 25; i++)
      sandboxes[0]?.emit({ type: 'console', level: 'log', text: 'x' });
    await vi.advanceTimersByTimeAsync(60);
    expect(lines.filter(l => l.text === 'x')).toHaveLength(MAX_MESSAGES_PER_RUN);
    expect(lines.filter(l => l.text.startsWith('Output limit reached'))).toHaveLength(1);
  });

  it('stops a preview that goes silent (endless loop or navigation) after the timeout', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    sandboxes[0]?.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(2500);
    sandboxes[0]?.emit({ type: 'alive' });
    await vi.advanceTimersByTimeAsync(2500);
    expect(types()).not.toContain('timeout');
    await vi.advanceTimersByTimeAsync(1500);
    expect(events.at(-1)).toMatchObject({ type: 'timeout', message: expect.stringContaining('stopped responding') });
    expect(sandboxes[0]?.destroyed).toBe(true);
    expect(runner.active).toBe(false);
  });

  it('recreates a frame that never says ready, up to the retry limit, then fails clearly', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    expect(sandboxes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sandboxes).toHaveLength(2);
    expect(sandboxes[0]?.destroyed).toBe(true);
    expect(lines.some(l => l.text.includes('slow to start'))).toBe(true);
    sandboxes[1]?.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(2500);
    expect(sandboxes).toHaveLength(2);
    expect(types()).not.toContain('failed');
  });

  it('gives up after the retries with a message that mentions offline use', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    await vi.advanceTimersByTimeAsync(2000 * 5 + 100);
    expect(sandboxes).toHaveLength(5);
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'TIMEOUT', message: expect.stringContaining('offline') },
    });
  });

  it('waits longer for the next frame right after a stalled preview, says why, and then recovers', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    sandboxes[0]?.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(4500);
    expect(events.at(-1)).toMatchObject({ type: 'timeout' });
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p id="ok"/>' });
    const first = sandboxes.length;
    await vi.advanceTimersByTimeAsync(2000 * 8);
    expect(sandboxes.length).toBe(first + 8);
    expect(events.at(-1)).not.toMatchObject({ type: 'failed' });
    expect(lines.filter(l => l.text.includes('still shutting down'))).toHaveLength(1);
    sandboxes.at(-1)?.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(types()).not.toContain('failed');
    expect(runner.active).toBe(true);
  });

  it('gives up after the longer post-stall budget too, and returns to the short budget later', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    sandboxes[0]?.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(4500);
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    const before = sandboxes.length;
    await vi.advanceTimersByTimeAsync(2000 * (MAX_BOOT_RETRIES_AFTER_STALL + 1) + 100);
    expect(sandboxes.length - before).toBe(MAX_BOOT_RETRIES_AFTER_STALL);
    expect(events.at(-1)).toMatchObject({ type: 'failed', error: { code: 'TIMEOUT' } });
    await vi.advanceTimersByTimeAsync(60_000);
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    const later = sandboxes.length;
    await vi.advanceTimersByTimeAsync(2000 * 5 + 100);
    expect(sandboxes.length - later).toBe(4);
    expect(events.at(-1)).toMatchObject({ type: 'failed' });
  });

  it('fails without a sandbox when the page cannot be built, or no preview pane is open', async () => {
    const runner = makeRunner();
    await runner.run(
      { mode: 'preview', entry: 'index.html' },
      { 'index.html': '<script type="module" src="m.ts"></script>', 'm.ts': 'import "lodash";' }
    );
    expect(events.at(-1)).toMatchObject({ type: 'failed', error: { code: 'UNSUPPORTED_DEPENDENCY' } });
    expect(sandboxes).toHaveLength(0);
    previewMount = null;
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    expect(events.at(-1)).toMatchObject({ type: 'failed', error: { code: 'UNSUPPORTED_RUNTIME' } });
  });

  it('replaces the previous sandbox on a new run and ignores late events from it', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    const first = sandboxes[0] as FakeSandbox;
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    expect(first.destroyed).toBe(true);
    first.emit({ type: 'console', level: 'log', text: 'ghost' });
    await vi.advanceTimersByTimeAsync(60);
    expect(lines.some(l => l.text === 'ghost')).toBe(false);
  });

  it('stop() destroys the sandbox, reports it, and flushes pending output first', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    sandboxes[0]?.emit({ type: 'ready' });
    sandboxes[0]?.emit({ type: 'console', level: 'log', text: 'last words' });
    runner.stop();
    expect(sandboxes[0]?.destroyed).toBe(true);
    expect(lines.map(l => l.text)).toEqual(expect.arrayContaining(['last words', 'Stopped.']));
    expect(events.at(-1)).toMatchObject({ type: 'stop' });
    runner.stop();
    expect(events.filter(e => e.type === 'stop')).toHaveLength(1);
  });
});

describe('Runner (console program)', () => {
  const program = { 'main.ts': 'console.log(1 as number);' };

  it('runs in a hidden sandbox and finishes when the program signals done', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'script', entry: 'main.ts' }, program);
    expect(sandboxes[0]?.visible).toBe(false);
    expect(sandboxes[0]?.posted[0]).toMatchObject({ type: 'run-worker' });
    const code = (sandboxes[0]?.posted[0] as { code: string }).code;
    expect(code).toContain('__nexusFinish');
    sandboxes[0]?.emit({ type: 'ready' });
    sandboxes[0]?.emit({ type: 'console', level: 'log', text: '1' });
    sandboxes[0]?.emit({ type: 'done' });
    expect(events.at(-1)).toMatchObject({ type: 'finished' });
    expect(sandboxes[0]?.destroyed).toBe(true);
    expect(lines.map(l => l.text)).toEqual(expect.arrayContaining(['1', 'Program finished.']));
  });

  it('kills a program still running at the timeout', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'script', entry: 'main.ts' }, program);
    sandboxes[0]?.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(3100);
    expect(events.at(-1)).toMatchObject({ type: 'timeout' });
    expect(sandboxes[0]?.destroyed).toBe(true);
    expect(lines.some(l => l.level === 'error' && l.text.includes('still running after 3s'))).toBe(true);
  });

  it('treats an uncaught error as the end of the program (like Node)', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'script', entry: 'main.ts' }, program);
    sandboxes[0]?.emit({ type: 'ready' });
    sandboxes[0]?.emit({ type: 'error', message: 'ReferenceError: x is not defined' });
    expect(events.at(-1)).toMatchObject({ type: 'failed', error: { message: 'ReferenceError: x is not defined' } });
    expect(sandboxes[0]?.destroyed).toBe(true);
  });

  it('does not stop a page preview for an error event (the page keeps running)', async () => {
    const runner = makeRunner();
    await runner.run({ mode: 'preview', entry: 'index.html' }, { 'index.html': '<p/>' });
    sandboxes[0]?.emit({ type: 'ready' });
    sandboxes[0]?.emit({ type: 'error', message: 'boom' });
    await flush();
    expect(sandboxes[0]?.destroyed).toBe(false);
    expect(types()).not.toContain('failed');
  });
});
