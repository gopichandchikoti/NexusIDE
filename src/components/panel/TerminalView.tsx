import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getRepl } from '@/app/services';
import { applyData, initialLine, type LineState } from '@/domain/replLine';
import type { ReplSession } from '@/runtime/repl';

const PROMPT = '\x1b[38;5;215m›\x1b[0m ';
const PROMPT_WIDTH = 2;
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const BANNER = [
  `${DIM}NexusIDE JavaScript REPL${RESET}`,
  `${DIM}Runs in an isolated sandbox: no network, no file system, no Node. Type help.${RESET}`,
];

function readTheme(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string): string => css.getPropertyValue(name).trim();
  return {
    background: v('--surface'),
    foreground: v('--text'),
    cursor: v('--accent'),
    selectionBackground: v('--surface-3'),
  };
}

/**
 * Minimal terminal output for a line edit. Typing at the end of the line and backspace only write the change
 * (so screen readers announce one character, not the whole line again); anything else redraws the line.
 */
function echo(term: Terminal, prev: LineState, next: LineState, chunk: string): void {
  const atEnd = prev.cursor === prev.buffer.length && next.cursor === next.buffer.length;
  if (atEnd && next.buffer.length === prev.buffer.length + chunk.length && next.buffer.endsWith(chunk)) {
    term.write(chunk);
  } else if (atEnd && chunk === '\x7f' && next.buffer.length === prev.buffer.length - 1) {
    term.write('\b \b');
  } else {
    term.write(`\r\x1b[2K${PROMPT}${next.buffer}\r\x1b[${PROMPT_WIDTH + next.cursor}C`);
  }
}

interface ReplIo {
  readonly repl: ReplSession;
  readonly println: (text: string) => void;
  readonly clear: () => void;
}

/** Built-in commands (help, clear, reset) or evaluation of the line as JavaScript in the sandbox. */
async function runReplLine(source: string, io: ReplIo): Promise<void> {
  const command = source.trim();
  if (command === '') return;
  if (command === 'help') {
    io.println('Commands: help, clear, reset. Anything else is evaluated as JavaScript.');
    io.println(`${DIM}Ctrl+C interrupts a long evaluation (the session restarts). Ctrl+L clears.${RESET}`);
    return;
  }
  if (command === 'clear') return io.clear();
  if (command === 'reset') {
    io.repl.reset();
    return io.println(`${DIM}Session reset.${RESET}`);
  }
  const result = await io.repl.evaluate(source);
  io.println(result.ok ? `${DIM}=>${RESET} ${result.text}` : `${RED}${result.text}${RESET}`);
}

export default function TerminalView() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let alive = true;
    const term = new Terminal({
      fontFamily: "'JetBrains Mono Variable', ui-monospace, Consolas, monospace",
      fontSize: 13,
      cursorBlink: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      screenReaderMode: true,
      convertEol: true,
      scrollback: 2000,
      theme: readTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const refit = (): void => {
      if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit();
    };
    refit();

    let line: LineState = initialLine;
    let busy = false;
    const typedAhead: string[] = [];
    const prompt = (): void => {
      term.write(`\r\x1b[2K${PROMPT}${line.buffer}\r\x1b[${PROMPT_WIDTH + line.cursor}C`);
    };
    const println = (text: string): void => {
      if (alive) term.write(`\r\x1b[2K${text}\r\n`);
    };
    const repl = getRepl((level, text) => println(level === 'error' ? `${RED}${text}${RESET}` : text));

    const runLine = (source: string): Promise<void> =>
      runReplLine(source, { repl, println, clear: () => term.clear() });

    const handle = (chunk: string): void => {
      if (busy) {
        // Ctrl+C aborts the running evaluation; everything else is typed ahead and replayed afterwards.
        if (chunk === '\x03') repl.reset();
        else typedAhead.push(chunk);
        return;
      }
      const result = applyData(line, chunk);
      const previous = line;
      line = result.state;
      if (result.clearScreen) term.clear();
      if (result.interrupt) term.write('^C\r\n');
      if (result.submit === undefined) return echo(term, previous, line, chunk);
      term.write('\r\n');
      busy = true;
      void runLine(result.submit).then(() => {
        if (!alive) return;
        busy = false;
        prompt();
        typedAhead.splice(0).forEach(handle);
      });
    };

    const data = term.onData(handle);
    BANNER.forEach(println);
    prompt();
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    const theme = new MutationObserver(() => {
      term.options.theme = readTheme();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      alive = false;
      observer.disconnect();
      theme.disconnect();
      data.dispose();
      term.dispose();
    };
  }, []);

  return <div ref={host} className="repl" role="group" aria-label="JavaScript REPL terminal" />;
}
