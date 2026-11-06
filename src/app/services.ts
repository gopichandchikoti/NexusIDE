import { Runner } from '@/runtime/runner';
import { ReplSession } from '@/runtime/repl';
import { startPersistence, type PersistenceController } from '@/store/persistence';
import { useRunStore } from '@/store/runStore';
import { useSettingsStore } from '@/store/settingsStore';

/** DOM nodes the sandbox iframes are attached to. Registered by the components that own them. */
export const mounts: { preview: HTMLElement | null; hidden: HTMLElement | null } = { preview: null, hidden: null };

let persistence: PersistenceController | null = null;
let runner: Runner | null = null;
let repl: ReplSession | null = null;
let replConsole: ((level: string, text: string) => void) | null = null;

export function getPersistence(): PersistenceController {
  persistence ??= startPersistence();
  return persistence;
}

export function stopPersistence(): void {
  persistence?.stop();
  persistence = null;
}

function hiddenMount(): HTMLElement {
  return mounts.hidden ?? document.body;
}

export function getRunner(): Runner {
  runner ??= new Runner({
    previewMount: () => mounts.preview,
    hiddenMount,
    timeoutMs: () => useSettingsStore.getState().runTimeoutSec * 1000,
    emit: event => useRunStore.getState().dispatch(event),
    log: (level, text) => useRunStore.getState().log(level, text),
    logMany: lines => useRunStore.getState().logMany(lines),
    now: () => Date.now(),
  });
  return runner;
}

export function getRepl(onConsole: (level: string, text: string) => void): ReplSession {
  replConsole = onConsole;
  repl ??= new ReplSession({ hiddenMount, onConsole: (level, text) => replConsole?.(level, text) });
  return repl;
}

export function disposeRuntime(): void {
  runner?.stop();
  repl?.dispose();
  runner = null;
  repl = null;
  replConsole = null;
}
