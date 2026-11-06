import { bridgeSource } from './bridgeSource';
import type { SandboxEvent } from './protocol';
import { createSandbox, type Sandbox } from './sandboxHost';

export interface ReplResult {
  readonly ok: boolean;
  readonly text: string;
}

export interface ReplDeps {
  hiddenMount(): HTMLElement;
  /** Output produced by console.* calls made by evaluated code */
  onConsole(level: string, text: string): void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * A JavaScript REPL whose engine is a Worker inside the sandbox iframe. It is not a shell: there is no file system,
 * no network and no process. An evaluation that does not finish in time destroys the whole sandbox (state is lost).
 */
export class ReplSession {
  private sandbox: Sandbox | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: ReplResult) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly deps: ReplDeps) {}

  evaluate(code: string): Promise<ReplResult> {
    const sandbox = this.ensure();
    const id = this.nextId++;
    return new Promise(resolve => {
      const timer = setTimeout(() => this.expire(id), this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      sandbox.post({ source: 'nexus-host', type: 'to-worker', payload: { id, code } });
    });
  }

  reset(): void {
    this.sandbox?.destroy();
    this.sandbox = null;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, text: 'Session was reset.' });
      this.pending.delete(id);
    }
  }

  dispose(): void {
    this.reset();
  }

  private ensure(): Sandbox {
    if (this.sandbox) return this.sandbox;
    const sandbox = createSandbox(this.deps.hiddenMount(), event => this.handle(event), {
      visible: false,
      title: 'JavaScript REPL (sandboxed)',
    });
    sandbox.post({ source: 'nexus-host', type: 'run-worker', code: bridgeSource('repl') });
    this.sandbox = sandbox;
    return sandbox;
  }

  private expire(id: number): void {
    const seconds = Math.round((this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000);
    const entry = this.pending.get(id);
    // Answer the timed-out one with its real reason first: reset() answers every other pending one "Session was reset."
    if (entry) {
      this.pending.delete(id);
      entry.resolve({ ok: false, text: `Timed out after ${seconds}s. The session was reset.` });
    }
    this.reset();
  }

  private handle(event: SandboxEvent): void {
    if (event.type === 'console') this.deps.onConsole(event.level, event.text);
    if (event.type !== 'repl-result') return;
    const entry = this.pending.get(event.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(event.id);
    entry.resolve({ ok: event.ok, text: event.text });
  }
}
