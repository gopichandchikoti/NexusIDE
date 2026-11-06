// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage, SandboxEvent } from './protocol';

interface Fake {
  posted: HostMessage[];
  destroyed: boolean;
  emit: (event: SandboxEvent) => void;
}
const created: Fake[] = [];

vi.mock('./sandboxHost', () => ({
  createSandbox: (_mount: HTMLElement, onEvent: (e: SandboxEvent) => void) => {
    const fake: Fake = { posted: [], destroyed: false, emit: onEvent };
    created.push(fake);
    return {
      frame: {},
      post: (m: HostMessage) => fake.posted.push(m),
      destroy: () => {
        fake.destroyed = true;
      },
    };
  },
}));

const { ReplSession } = await import('./repl');

let console_: Array<[string, string]>;
const make = (timeoutMs = 1000) =>
  new ReplSession({ hiddenMount: () => document.body, onConsole: (l, t) => console_.push([l, t]), timeoutMs });
const lastEval = (fake: Fake) => (fake.posted.at(-1) as { payload: { id: number; code: string } }).payload;

beforeEach(() => {
  vi.useFakeTimers();
  created.length = 0;
  console_ = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ReplSession', () => {
  it('starts one worker sandbox lazily, sends the code, and resolves with the result', async () => {
    const repl = make();
    expect(created).toHaveLength(0);
    const pending = repl.evaluate('1 + 1');
    expect(created).toHaveLength(1);
    expect(created[0]?.posted[0]).toMatchObject({ type: 'run-worker' });
    const { id, code } = lastEval(created[0] as Fake);
    expect(code).toBe('1 + 1');
    created[0]?.emit({ type: 'repl-result', id, ok: true, text: '2' });
    await expect(pending).resolves.toEqual({ ok: true, text: '2' });
    const second = repl.evaluate('x');
    expect(created).toHaveLength(1);
    created[0]?.emit({ type: 'repl-result', id: lastEval(created[0] as Fake).id, ok: false, text: 'ReferenceError' });
    await expect(second).resolves.toEqual({ ok: false, text: 'ReferenceError' });
  });

  it('forwards console output from evaluated code and ignores unknown results', async () => {
    const repl = make();
    const pending = repl.evaluate('console.log(1)');
    created[0]?.emit({ type: 'console', level: 'warn', text: 'careful' });
    created[0]?.emit({ type: 'repl-result', id: 9999, ok: true, text: 'stray' });
    expect(console_).toEqual([['warn', 'careful']]);
    created[0]?.emit({ type: 'repl-result', id: lastEval(created[0] as Fake).id, ok: true, text: 'undefined' });
    await pending;
  });

  it('destroys the sandbox and reports a timeout when an evaluation never finishes', async () => {
    const repl = make(1000);
    const pending = repl.evaluate('while (true) {}');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ ok: false, text: expect.stringContaining('Timed out after 1s') });
    expect(created[0]?.destroyed).toBe(true);
    const next = repl.evaluate('2');
    expect(created).toHaveLength(2);
    created[1]?.emit({ type: 'repl-result', id: lastEval(created[1] as Fake).id, ok: true, text: '2' });
    await expect(next).resolves.toEqual({ ok: true, text: '2' });
  });

  it('reset() answers pending evaluations and discards the session', async () => {
    const repl = make();
    const pending = repl.evaluate('slow()');
    repl.reset();
    await expect(pending).resolves.toEqual({ ok: false, text: 'Session was reset.' });
    expect(created[0]?.destroyed).toBe(true);
    repl.dispose();
  });
});
