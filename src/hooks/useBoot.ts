import { useEffect, useState } from 'react';
import { getPersistence } from '@/app/services';
import { boot } from '@/store/boot';
import { useEditorStore } from '@/store/editorStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

let started: Promise<void> | null = null;

function bootOnce(): Promise<void> {
  started ??= boot(getPersistence()).then(() => {
    // Close tabs whose files were deleted or replaced.
    useWorkspaceStore.subscribe((state, prev) => {
      if (state.structure !== prev.structure) {
        useEditorStore.getState().prune(new Set(Object.keys(state.fs)));
      }
    });
  });
  return started;
}

/** Loads the saved workspace once per page load. Resolves even if storage is unavailable (session mode). */
export function useBoot(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void bootOnce().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}
