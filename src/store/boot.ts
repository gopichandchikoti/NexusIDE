import type { Draft } from '@/services/db';
import { listDrafts, loadWorkspace, removeDrafts } from '@/services/workspaceRepo';
import { loadSession, useEditorStore } from './editorStore';
import type { PersistenceController } from './persistence';
import { useRecoveryStore } from './recoveryStore';
import { useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

export interface BootReport {
  readonly firstRun: boolean;
  readonly ephemeral: boolean;
  readonly recoverable: number;
}

function applicableDrafts(drafts: readonly Draft[], fs: Record<string, { content: string }>): Draft[] {
  return drafts.filter(d => fs[d.fileId] !== undefined && fs[d.fileId]?.content !== d.content);
}

function restoreTabs(state: Record<string, { kind: string }>): void {
  const session = loadSession();
  const open = session.tabs.filter(id => state[id]?.kind === 'file');
  const editor = useEditorStore.getState();
  open.forEach(id => editor.openFile(id));
  if (session.active && open.includes(session.active)) editor.setActive(session.active);
}

/** Unsaved edits found at startup are offered to the user; drafts that match saved text are cleaned up. */
async function offerRecovery(state: Record<string, { content: string }>): Promise<number> {
  const drafts = await listDrafts();
  if (!drafts.ok) return 0;
  const keep = applicableDrafts(drafts.value, state);
  const stale = drafts.value.filter(d => !keep.includes(d)).map(d => d.fileId);
  if (stale.length > 0) await removeDrafts(stale);
  if (keep.length > 0) useRecoveryStore.getState().offer(keep);
  return keep.length;
}

/** Loads the workspace, restores the previous tab session, and offers unsaved edits from a crashed session. */
export async function boot(persistence: PersistenceController): Promise<BootReport> {
  const ui = useUiStore.getState();
  const loaded = await loadWorkspace();
  if (!loaded.ok) {
    useWorkspaceStore.getState().hydrate({}, true);
    ui.toast('error', `${loaded.error.message} You can still edit, but nothing will be saved.`);
    return { firstRun: true, ephemeral: true, recoverable: 0 };
  }
  const { state, hadData, dropped, repaired } = loaded.value;
  useWorkspaceStore.getState().hydrate(state);
  persistence.setCommitted(state);
  restoreTabs(state);
  if (dropped > 0 || repaired > 0) {
    ui.toast('warning', `Some stored data was damaged: ${dropped} item(s) skipped, ${repaired} repaired.`);
  }
  const recoverable = await offerRecovery(state);
  return { firstRun: !hadData && Object.keys(state).length === 0, ephemeral: false, recoverable };
}
