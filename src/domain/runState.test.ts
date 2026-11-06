import { describe, expect, it } from 'vitest';
import { initialRunState, runReducer } from './runState';

describe('runReducer timeout message', () => {
  it('uses a custom message (preview hang) and falls back to the default', () => {
    const started = runReducer(initialRunState, {
      type: 'start',
      runId: 1,
      mode: 'preview',
      entry: 'index.html',
      now: 1,
    });
    const hung = runReducer(started, { type: 'timeout', runId: 1, now: 9, message: 'page hung' });
    expect(hung).toMatchObject({ phase: 'timed-out', error: { code: 'TIMEOUT', message: 'page hung' } });
    const plain = runReducer(started, { type: 'timeout', runId: 1, now: 9 });
    expect(plain.error?.message).toBe('The program ran too long and was stopped.');
  });
});
