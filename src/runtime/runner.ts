import { ok, type AppError, type Result } from '@/domain/errors';
import type { RunTarget } from '@/domain/runTarget';
import type { RunEvent } from '@/domain/runState';
import { bridgeSource } from './bridgeSource';
import { bundleModules, type SourceFiles } from './bundler';
import { buildPreviewDocument } from './documentBuilder';
import { OutputBuffer, type BufferedLine } from './outputBuffer';
import type { ConsoleLevel, HostMessage, SandboxEvent } from './protocol';
import { createSandbox, type Sandbox } from './sandboxHost';

export interface RunnerDeps {
  /** Where the visible preview iframe goes; null when the preview pane is not on screen. */
  previewMount(): HTMLElement | null;
  hiddenMount(): HTMLElement;
  timeoutMs(): number;
  emit(event: RunEvent): void;
  log(level: ConsoleLevel | 'system', text: string): void;
  /** Program output, delivered in batches */
  logMany(lines: readonly BufferedLine[]): void;
  now(): number;
}

/** Hard cap on messages per run. A program printing in a loop cannot flood the UI. */
export const MAX_MESSAGES_PER_RUN = 5000;
const WATCHDOG_TICK_MS = 1000;
const BOOT_TIMEOUT_MS = 2000;
/** Chromium needs 3-6 s to kill a renderer stuck in a hostile loop, and a new frame can land in it meanwhile. */
const MAX_BOOT_RETRIES = 4;
/**
 * Right after a run was stopped for being unresponsive the old renderer is still dying. Measured in Edge 156: the next
 * frame is ready about 2.3 s later on its own, but about 10 s later while a debugger (DevTools, Playwright) is attached
 * to the stuck frame. So the next run waits longer instead of failing, and says why.
 */
export const MAX_BOOT_RETRIES_AFTER_STALL = 10;
const STALL_MEMORY_MS = 30_000;

interface LaunchPlan {
  readonly mount: HTMLElement;
  readonly message: HostMessage;
  readonly mode: RunTarget['mode'];
}

interface Prepared {
  readonly message: HostMessage;
  readonly notices: readonly string[];
}

async function prepare(target: RunTarget, files: SourceFiles): Promise<Result<Prepared>> {
  if (target.mode === 'preview') {
    const built = await buildPreviewDocument(files, target.entry);
    if (!built.ok) return built;
    return ok({
      message: { source: 'nexus-host', type: 'run-document', html: built.value.html },
      notices: built.value.notices,
    });
  }
  const bundle = await bundleModules(files, target.entry, { externals: [] });
  if (!bundle.ok) return bundle;
  const code = `${bridgeSource('script')}${bundle.value.code}\n;self.__nexusFinish();`;
  return ok({ message: { source: 'nexus-host', type: 'run-worker', code }, notices: [] });
}

/** Owns at most one running program. Starting a new run, or calling stop(), destroys the previous sandbox. */
export class Runner {
  private sandbox: Sandbox | null = null;
  private building = false;
  private plan: LaunchPlan | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastSeen = 0;
  private lastStallAt = Number.NEGATIVE_INFINITY;
  private bootRetries = MAX_BOOT_RETRIES;
  private counter = 0;
  private sent = 0;
  private mode: RunTarget['mode'] = 'preview';
  private readonly buffer: OutputBuffer;

  constructor(private readonly deps: RunnerDeps) {
    this.buffer = new OutputBuffer((lines, chars) => {
      deps.logMany(lines);
      deps.emit({ type: 'output', runId: this.counter, chars, count: lines.length });
    });
  }

  get active(): boolean {
    return this.building || this.sandbox !== null;
  }

  async run(target: RunTarget, files: SourceFiles): Promise<void> {
    this.teardown();
    const runId = ++this.counter;
    this.building = true;
    this.sent = 0;
    this.mode = target.mode;
    this.bootRetries =
      this.deps.now() - this.lastStallAt < STALL_MEMORY_MS ? MAX_BOOT_RETRIES_AFTER_STALL : MAX_BOOT_RETRIES;
    this.deps.emit({ type: 'start', runId, mode: target.mode, entry: target.entry, now: this.deps.now() });
    this.deps.log(
      'system',
      `Running ${target.entry} (${target.mode === 'preview' ? 'page preview' : 'console program'})`
    );
    const prepared = await prepare(target, files).catch((cause: unknown): Result<Prepared> => ({
      ok: false,
      error: { code: 'BUILD_FAILED', message: 'The project could not be built.', details: String(cause) },
    }));
    if (runId !== this.counter) return;
    this.building = false;
    if (!prepared.ok) return this.fail(runId, prepared.error);
    prepared.value.notices.forEach(n => this.deps.log('warn', n));
    const mount = target.mode === 'preview' ? this.deps.previewMount() : this.deps.hiddenMount();
    if (!mount) {
      return this.fail(runId, { code: 'UNSUPPORTED_RUNTIME', message: 'Open the preview pane to run a page.' });
    }
    this.plan = { mount, message: prepared.value.message, mode: target.mode };
    this.launch(runId, 0);
    this.deps.emit({ type: 'built', runId });
    if (target.mode === 'script') this.timer = setTimeout(() => this.timeout(runId), this.deps.timeoutMs());
    else this.watch(runId);
  }

  /**
   * Creates the sandbox frame and expects its `ready` handshake. A frame can land in a renderer that is still
   * busy dying (for example right after a hung preview was destroyed) and never load, so it is recreated.
   */
  private launch(runId: number, attempt: number): void {
    const plan = this.plan;
    if (!plan) return;
    this.sandbox = createSandbox(plan.mount, event => this.handle(runId, event), {
      visible: plan.mode === 'preview',
      title: plan.mode === 'preview' ? 'Preview of your project (sandboxed)' : 'Console program (sandboxed)',
    });
    this.sandbox.post(plan.message);
    this.lastSeen = this.deps.now();
    this.bootTimer = setTimeout(() => this.bootStalled(runId, attempt), BOOT_TIMEOUT_MS);
  }

  private bootStalled(runId: number, attempt: number): void {
    if (runId !== this.counter) return;
    this.sandbox?.destroy();
    this.sandbox = null;
    if (attempt >= this.bootRetries) {
      return this.fail(runId, {
        code: 'TIMEOUT',
        message:
          'The sandbox did not start. If you are offline and your browser cache was cleared, reconnect once; otherwise reload the page.',
      });
    }
    if (this.bootRetries === MAX_BOOT_RETRIES) this.deps.log('system', 'The sandbox was slow to start; retrying.');
    else if (attempt === 0) {
      this.deps.log('system', 'The browser is still shutting down the previous stuck preview; waiting for it.');
    }
    this.launch(runId, attempt + 1);
  }

  /**
   * A page preview sends a heartbeat every second. If none arrives for `timeoutMs`, the page is stuck in a loop or
   * navigated away, so the frame is destroyed. (Chromium keeps the frame off this window's thread; see docs.)
   */
  private watch(runId: number): void {
    this.lastSeen = this.deps.now();
    this.watchdog = setInterval(() => {
      if (this.deps.now() - this.lastSeen <= this.deps.timeoutMs()) return;
      this.stalled(runId);
    }, WATCHDOG_TICK_MS);
  }

  private stalled(runId: number): void {
    if (runId !== this.counter) return;
    this.teardown();
    this.lastStallAt = this.deps.now();
    const seconds = Math.round(this.deps.timeoutMs() / 1000);
    const message = `The preview stopped responding for ${seconds}s (an endless loop, or the page navigated away) and was stopped.`;
    this.deps.log('error', message);
    this.deps.emit({ type: 'timeout', runId, now: this.deps.now(), message });
  }

  stop(): void {
    if (!this.active) return;
    this.teardown();
    this.counter += 1;
    this.deps.emit({ type: 'stop', now: this.deps.now() });
    this.deps.log('system', 'Stopped.');
  }

  private teardown(): void {
    this.building = false;
    this.buffer.flush();
    if (this.timer) clearTimeout(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.timer = null;
    this.bootTimer = null;
    this.watchdog = null;
    this.sandbox?.destroy();
    this.sandbox = null;
  }

  private fail(runId: number, error: AppError): void {
    this.teardown();
    this.deps.log('error', error.message);
    this.deps.emit({ type: 'failed', runId, error, now: this.deps.now() });
  }

  private timeout(runId: number): void {
    if (runId !== this.counter) return;
    this.teardown();
    this.lastStallAt = this.deps.now();
    this.deps.log(
      'error',
      `Stopped: the program was still running after ${Math.round(this.deps.timeoutMs() / 1000)}s.`
    );
    this.deps.emit({ type: 'timeout', runId, now: this.deps.now() });
  }

  private handle(runId: number, event: SandboxEvent): void {
    if (runId !== this.counter) return;
    this.lastSeen = this.deps.now();
    switch (event.type) {
      case 'ready':
        if (this.bootTimer) clearTimeout(this.bootTimer);
        this.bootTimer = null;
        return;
      case 'console':
        return this.output(event.level, event.text);
      case 'error':
        this.output('error', event.message);
        if (this.mode === 'script') this.fail(runId, { code: 'BUILD_FAILED', message: event.message });
        return;
      case 'done':
        this.teardown();
        this.deps.log('system', 'Program finished.');
        this.deps.emit({ type: 'finished', runId, now: this.deps.now() });
        return;
      default:
        return;
    }
  }

  private output(level: ConsoleLevel, text: string): void {
    this.sent += 1;
    if (this.sent > MAX_MESSAGES_PER_RUN) {
      if (this.sent === MAX_MESSAGES_PER_RUN + 1) {
        this.buffer.push({ level: 'warn', text: 'Output limit reached; further output is dropped.' });
      }
      return;
    }
    this.buffer.push({ level, text });
  }
}
