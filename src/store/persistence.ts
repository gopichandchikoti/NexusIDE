import type { FsState } from '@/domain/fs';
import { putDraft, removeDrafts, saveChanges } from '@/services/workspaceRepo';
import { useSettingsStore } from './settingsStore';
import { useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

export interface PersistenceOptions {
  readonly draftDelayMs: number;
  readonly commitDelayMs: number;
  readonly structuralDelayMs: number;
}

export const DEFAULT_PERSISTENCE: PersistenceOptions = {
  draftDelayMs: 300,
  commitDelayMs: 1000,
  structuralDelayMs: 60,
};

export interface PersistenceController {
  /** Journal drafts and commit everything now (Ctrl+S). Resolves when the write finished. */
  saveNow(): Promise<boolean>;
  /** Tell the controller what is already in IndexedDB (after boot, restore or replace). */
  setCommitted(fs: FsState): void;
  stop(): void;
}

const CHANNEL = 'nexuside-workspace';
const CROSS_TAB_COOLDOWN_MS = 30_000;

function isStructural(next: FsState, prev: FsState): boolean {
  const ids = Object.keys(next);
  if (ids.length !== Object.keys(prev).length) return true;
  return ids.some(id => {
    const a = next[id];
    const b = prev[id];
    return !b || a?.name !== b.name || a.parentId !== b.parentId;
  });
}

function changedContentIds(next: FsState, prev: FsState): string[] {
  return Object.keys(next).filter(id => prev[id] !== undefined && next[id]?.content !== prev[id]?.content);
}

const isActive = (): boolean => {
  const { status, ephemeral } = useWorkspaceStore.getState();
  return status === 'ready' && !ephemeral;
};

/** Tier 1: every text change is journaled to IndexedDB shortly after typing. This is the crash-recovery net. */
function createDraftJournal(delayMs: number) {
  const pending = new Set<string>();
  const journaled = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    const { fs } = useWorkspaceStore.getState();
    const ids = [...pending];
    pending.clear();
    await Promise.all(
      ids.map(async id => {
        const node = fs[id];
        if (node?.kind !== 'file') return;
        journaled.add(id);
        await putDraft({ fileId: id, content: node.content, savedAt: Date.now() });
      })
    );
  };

  return {
    note(ids: readonly string[]): void {
      ids.forEach(id => pending.add(id));
      if (ids.length > 0 && !timer) timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    journaled,
    reset(): void {
      journaled.clear();
      pending.clear();
    },
    stop(): void {
      if (timer) clearTimeout(timer);
    },
  };
}

type Journal = ReturnType<typeof createDraftJournal>;

/** Tell the user about another tab's commit, at most once per cooldown. */
function createCrossTabWatch() {
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  const tabId = Math.random().toString(36).slice(2);
  let lastNotice = 0;
  if (channel) {
    channel.onmessage = event => {
      const data = event.data as { type?: string; tab?: string } | null;
      if (data?.type !== 'committed' || data.tab === tabId || Date.now() - lastNotice < CROSS_TAB_COOLDOWN_MS) return;
      lastNotice = Date.now();
      const message = 'This workspace was changed in another NexusIDE tab. Saving here overwrites those changes.';
      useUiStore.getState().toast('warning', message);
    };
  }
  return {
    announce: (): void => channel?.postMessage({ type: 'committed', tab: tabId }),
    stop: (): void => channel?.close(),
  };
}

/** Tier 2: the whole tree is written after idle, on structural changes, on Ctrl+S and when the page is hidden. */
function createCommitter(journal: Journal, announce: () => void) {
  let committed: FsState = useWorkspaceStore.getState().fs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<boolean> = Promise.resolve(true);
  let lastErrorCode: string | null = null;

  const fail = (code: string, message: string): void => {
    if (code === lastErrorCode) return;
    lastErrorCode = code;
    useUiStore.getState().toast('error', message);
  };

  const commitOnce = async (): Promise<boolean> => {
    if (!isActive()) return true;
    await journal.flush();
    const snapshot = useWorkspaceStore.getState().fs;
    const result = await saveChanges(committed, snapshot);
    if (!result.ok) {
      useWorkspaceStore.getState().setSaveError(result.error);
      fail(result.error.code, result.error.message);
      return false;
    }
    committed = snapshot;
    lastErrorCode = null;
    const current = useWorkspaceStore.getState().fs;
    if (current === snapshot) useWorkspaceStore.getState().markSaved(Date.now());
    const clearable = [...journal.journaled].filter(
      id => !current[id] || current[id]?.content === snapshot[id]?.content
    );
    clearable.forEach(id => journal.journaled.delete(id));
    if (clearable.length > 0) await removeDrafts(clearable);
    announce();
    return true;
  };

  const commitNow = (): Promise<boolean> => {
    if (timer) clearTimeout(timer);
    timer = null;
    inFlight = inFlight.then(commitOnce, commitOnce);
    return inFlight;
  };

  return {
    commitNow,
    schedule(delayMs: number): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void commitNow(), delayMs);
    },
    setCommitted(fs: FsState): void {
      committed = fs;
    },
    stop(): void {
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * Two tiers of durability:
 *  1. drafts: every text change is journaled within `draftDelayMs` (crash-recovery net).
 *  2. commits: the tree is written after `commitDelayMs` idle (autosave on), on structural changes,
 *     on Ctrl+S, and when the page is hidden. A successful commit clears the matching drafts.
 */
export function startPersistence(options: PersistenceOptions = DEFAULT_PERSISTENCE): PersistenceController {
  const journal = createDraftJournal(options.draftDelayMs);
  const tabs = createCrossTabWatch();
  const committer = createCommitter(journal, tabs.announce);

  const unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
    if (state.fs === prev.fs || !isActive()) return;
    journal.note(changedContentIds(state.fs, prev.fs));
    if (isStructural(state.fs, prev.fs)) committer.schedule(options.structuralDelayMs);
    else if (useSettingsStore.getState().autoSave) committer.schedule(options.commitDelayMs);
  });

  const onHidden = (): void => {
    if (document.visibilityState !== 'hidden') return;
    void journal.flush();
    if (useSettingsStore.getState().autoSave) void committer.commitNow();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onHidden);

  return {
    saveNow: async () => (isActive() ? committer.commitNow() : false),
    setCommitted(fs) {
      committer.setCommitted(fs);
      journal.reset();
    },
    stop() {
      unsubscribe();
      journal.stop();
      committer.stop();
      tabs.stop();
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
    },
  };
}
