import { memo, useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { useRunStore, type ConsoleLine, type LineLevel } from '@/store/runStore';
import { EmptyState } from '../ui/primitives';

/** Words next to colours so severity is never colour-only. */
const TAG: Record<LineLevel, string> = {
  log: '',
  info: 'info',
  debug: 'debug',
  warn: 'warn',
  error: 'error',
  system: 'nexus',
};

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false });
}

/** Memoised: appending a batch re-renders only the new rows, not all 500. */
const Row = memo(function Row({ line }: { readonly line: ConsoleLine }) {
  return (
    <div className={`console__line console__line--${line.level}`}>
      <span className="console__time">{time(line.at)}</span>
      <span className="console__tag">{TAG[line.level]}</span>
      <pre>{line.text}</pre>
    </div>
  );
});

export function ConsoleView() {
  const lines = useRunStore(s => s.lines);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (lines.length === 0) {
    return (
      <EmptyState icon={Terminal} title="Nothing printed yet">
        Press Run. Output from console.log, errors and run messages appear here.
      </EmptyState>
    );
  }
  return (
    <div
      ref={box}
      className="console"
      role="log"
      aria-label="Console output"
      aria-live="off"
      tabIndex={0}
      onScroll={event => {
        const el = event.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {lines.map(line => (
        <Row key={line.id} line={line} />
      ))}
    </div>
  );
}
