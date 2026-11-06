import type { AppError } from './errors';

export type RunPhase = 'idle' | 'building' | 'running' | 'finished' | 'failed' | 'timed-out' | 'stopped';
export type RunMode = 'preview' | 'script';

export interface RunState {
  readonly phase: RunPhase;
  readonly runId: number;
  readonly mode: RunMode | null;
  readonly entry: string | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly error: AppError | null;
  readonly messageCount: number;
  readonly outputChars: number;
}

export type RunEvent =
  | { type: 'start'; runId: number; mode: RunMode; entry: string; now: number }
  | { type: 'built'; runId: number }
  | { type: 'output'; runId: number; chars: number; count?: number }
  | { type: 'finished'; runId: number; now: number }
  | { type: 'failed'; runId: number; error: AppError; now: number }
  | { type: 'timeout'; runId: number; now: number; message?: string }
  | { type: 'stop'; now: number }
  | { type: 'reset' };

export const initialRunState: RunState = {
  phase: 'idle',
  runId: 0,
  mode: null,
  entry: null,
  startedAt: null,
  endedAt: null,
  error: null,
  messageCount: 0,
  outputChars: 0,
};

export function isBusy(state: RunState): boolean {
  return state.phase === 'building' || state.phase === 'running';
}

export function elapsedMs(state: RunState, now: number): number {
  if (state.startedAt === null) return 0;
  return Math.max(0, (state.endedAt ?? now) - state.startedAt);
}

function end(state: RunState, phase: RunPhase, now: number, error: AppError | null = null): RunState {
  return isBusy(state) ? { ...state, phase, endedAt: now, error } : state;
}

type RunScopedEvent = Exclude<RunEvent, { type: 'start' | 'stop' | 'reset' }>;

function reduceScoped(state: RunState, event: RunScopedEvent): RunState {
  switch (event.type) {
    case 'built':
      return state.phase === 'building' ? { ...state, phase: 'running' } : state;
    case 'output':
      return {
        ...state,
        messageCount: state.messageCount + (event.count ?? 1),
        outputChars: state.outputChars + event.chars,
      };
    case 'finished':
      return end(state, 'finished', event.now);
    case 'failed':
      return end(state, 'failed', event.now, event.error);
    case 'timeout':
      return end(state, 'timed-out', event.now, {
        code: 'TIMEOUT',
        message: event.message ?? 'The program ran too long and was stopped.',
      });
  }
}

/** Events from an older run are ignored so a late message from a killed sandbox cannot revive it. */
export function runReducer(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'reset':
      return { ...initialRunState, runId: state.runId };
    case 'start':
      return {
        ...initialRunState,
        phase: 'building',
        runId: event.runId,
        mode: event.mode,
        entry: event.entry,
        startedAt: event.now,
      };
    case 'stop':
      return end(state, 'stopped', event.now);
    default:
      return event.runId === state.runId ? reduceScoped(state, event) : state;
  }
}
