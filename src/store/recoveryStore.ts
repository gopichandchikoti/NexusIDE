import { create } from 'zustand';
import type { Draft } from '@/services/db';
import { removeDrafts } from '@/services/workspaceRepo';
import { useWorkspaceStore } from './workspaceStore';

export interface RecoveryStore {
  /** Unsaved edits found at startup (the previous session ended before they were committed). */
  readonly drafts: readonly Draft[];
  offer(drafts: readonly Draft[]): void;
  restore(): Promise<number>;
  discard(): Promise<void>;
}

export const useRecoveryStore = create<RecoveryStore>()((set, get) => ({
  drafts: [],
  offer: drafts => set({ drafts }),
  async restore() {
    const { drafts } = get();
    let restored = 0;
    for (const draft of drafts) {
      if (useWorkspaceStore.getState().setContent(draft.fileId, draft.content).ok) restored += 1;
    }
    set({ drafts: [] });
    return restored;
  },
  async discard() {
    const ids = get().drafts.map(d => d.fileId);
    set({ drafts: [] });
    await removeDrafts(ids);
  },
}));
