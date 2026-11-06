import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, PauseCircle, Play } from 'lucide-react';
import { elapsedMs, isBusy, type RunPhase } from '@/domain/runState';
import { useRunStore } from '@/store/runStore';

const TEXT: Record<RunPhase, string> = {
  idle: 'Ready',
  building: 'Building…',
  running: 'Running',
  finished: 'Finished',
  failed: 'Failed',
  'timed-out': 'Timed out',
  stopped: 'Stopped',
};

function PhaseIcon({ phase }: { readonly phase: RunPhase }) {
  if (phase === 'finished') return <CheckCircle2 size={14} aria-hidden="true" />;
  if (phase === 'failed' || phase === 'timed-out') return <AlertCircle size={14} aria-hidden="true" />;
  if (phase === 'stopped') return <PauseCircle size={14} aria-hidden="true" />;
  if (phase === 'idle') return <Clock size={14} aria-hidden="true" />;
  return <Play size={14} aria-hidden="true" />;
}

/** Run state, elapsed time and output volume. Text carries the meaning; colour is only reinforcement. */
export function RunChip() {
  const run = useRunStore(s => s.run);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isBusy(run)) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [run]);
  const seconds = (elapsedMs(run, now) / 1000).toFixed(1);
  const detail = run.phase === 'idle' ? '' : ` · ${seconds}s · ${run.messageCount} msg`;
  return (
    <span className={`chip chip--${run.phase}`} role="status" aria-live="polite">
      <PhaseIcon phase={run.phase} />
      <span>
        {TEXT[run.phase]}
        {detail}
      </span>
    </span>
  );
}
