import { create } from 'zustand';
import { LIMITS } from '@/domain/limits';
import { initialRunState, runReducer, type RunEvent, type RunState } from '@/domain/runState';
import type { ConsoleLevel } from '@/runtime/protocol';

export type LineLevel = ConsoleLevel | 'system';

export interface ConsoleLine {
  readonly id: number;
  readonly level: LineLevel;
  readonly text: string;
  readonly at: number;
}

export interface RunStore {
  readonly run: RunState;
  readonly lines: readonly ConsoleLine[];
  dispatch(event: RunEvent): void;
  log(level: LineLevel, text: string): void;
  /** Append many lines with a single state update (one re-render) */
  logMany(lines: ReadonlyArray<{ readonly level: LineLevel; readonly text: string }>): void;
  clear(): void;
}

let lineCounter = 0;

export const useRunStore = create<RunStore>()(set => ({
  run: initialRunState,
  lines: [],
  dispatch: event => set(s => ({ run: runReducer(s.run, event) })),
  log: (level, text) =>
    set(s => ({
      lines: [...s.lines, { id: ++lineCounter, level, text, at: Date.now() }].slice(-LIMITS.maxConsoleMessages),
    })),
  logMany: batch =>
    set(s => {
      const at = Date.now();
      const added = batch.slice(-LIMITS.maxConsoleMessages).map(l => ({ id: ++lineCounter, ...l, at }));
      return { lines: [...s.lines, ...added].slice(-LIMITS.maxConsoleMessages) };
    }),
  clear: () => set({ lines: [] }),
}));
