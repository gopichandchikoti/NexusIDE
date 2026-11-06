// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SandboxEvent } from '@/runtime/protocol';

const { emit } = vi.hoisted(() => ({ emit: { current: (_event: SandboxEvent): void => undefined } }));
vi.mock('@/runtime/sandboxHost', () => ({
  createSandbox: (_mount: HTMLElement, onEvent: (event: SandboxEvent) => void) => {
    emit.current = onEvent;
    return { frame: {}, post: vi.fn(), destroy: vi.fn() };
  },
}));

const { disposeRuntime, getRepl } = await import('./services');
afterEach(disposeRuntime);

describe('shared REPL session', () => {
  it('keeps the session but sends console output to the currently mounted terminal', async () => {
    const oldTerminal = vi.fn();
    const currentTerminal = vi.fn();
    const repl = getRepl(oldTerminal);
    const pending = repl.evaluate('var kept = 42');
    emit.current({ type: 'console', level: 'log', text: 'first' });
    expect(oldTerminal).toHaveBeenCalledWith('log', 'first');
    oldTerminal.mockClear();

    expect(getRepl(currentTerminal)).toBe(repl);
    emit.current({ type: 'console', level: 'warn', text: 'after remount' });

    expect(oldTerminal).not.toHaveBeenCalled();
    expect(currentTerminal).toHaveBeenCalledWith('warn', 'after remount');
    emit.current({ type: 'repl-result', id: 1, ok: true, text: 'undefined' });
    await expect(pending).resolves.toEqual({ ok: true, text: 'undefined' });
  });
});
