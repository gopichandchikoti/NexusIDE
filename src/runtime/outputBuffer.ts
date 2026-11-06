import type { ConsoleLevel } from './protocol';

export interface BufferedLine {
  readonly level: ConsoleLevel | 'system';
  readonly text: string;
}

/**
 * Collects console lines and hands them over in one batch per `delayMs`. Without this, a program that prints
 * thousands of lines makes the UI re-render once per line and the page stops responding.
 */
export class OutputBuffer {
  private lines: BufferedLine[] = [];
  private chars = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly sink: (lines: readonly BufferedLine[], chars: number) => void,
    private readonly delayMs = 50
  ) {}

  push(line: BufferedLine): void {
    this.lines.push(line);
    this.chars += line.text.length;
    this.timer ??= setTimeout(() => this.flush(), this.delayMs);
  }

  /** Delivers anything pending now. Call before logging a system line so the order is preserved. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.lines.length === 0) return;
    const batch = this.lines;
    const chars = this.chars;
    this.lines = [];
    this.chars = 0;
    this.sink(batch, chars);
  }
}
