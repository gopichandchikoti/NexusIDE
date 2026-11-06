import { fail, ok, type Result } from '@/domain/errors';
import { runEditorAction } from '@/editor/bridge';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore, type NameDialog } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { getPersistence } from './services';

/** Folder that new items go into: the selected folder, the selected file's parent, or the active file's parent. */
export function defaultParentId(): string | null {
  const { fs } = useWorkspaceStore.getState();
  const anchor = useUiStore.getState().selectedNodeId ?? useEditorStore.getState().active;
  const node = anchor ? fs[anchor] : undefined;
  if (!node) return null;
  return node.kind === 'folder' ? node.id : node.parentId;
}

export function promptNew(kind: 'file' | 'folder', parentId: string | null = defaultParentId()): void {
  useUiStore.getState().openNameDialog({ mode: kind, parentId });
}

export function promptRename(
  id: string | null = useUiStore.getState().selectedNodeId ?? useEditorStore.getState().active
): void {
  if (id && useWorkspaceStore.getState().fs[id]) useUiStore.getState().openNameDialog({ mode: 'rename', id });
}

/** Applies the Name dialog. Errors are returned so the dialog can show them next to the field. */
export function submitName(dialog: NameDialog, name: string): Result<void> {
  const ws = useWorkspaceStore.getState();
  if (dialog.mode === 'rename') return ws.rename(dialog.id, name);
  const created = ws.create({ parentId: dialog.parentId, name, kind: dialog.mode });
  if (!created.ok) return created;
  useUiStore.getState().selectNode(created.value.id);
  if (created.value.kind === 'file') useEditorStore.getState().openFile(created.value.id);
  return ok(undefined);
}

export function undoTree(): void {
  const result = useWorkspaceStore.getState().undo();
  const ui = useUiStore.getState();
  if (result.ok) ui.toast('info', `Undid: ${result.value}.`);
  else ui.toast('warning', result.error.message);
}

export function redoTree(): void {
  const result = useWorkspaceStore.getState().redo();
  const ui = useUiStore.getState();
  if (result.ok) ui.toast('info', `Redid: ${result.value}.`);
  else ui.toast('warning', result.error.message);
}

export function deleteNode(id: string): void {
  const ui = useUiStore.getState();
  const result = useWorkspaceStore.getState().remove(id);
  if (!result.ok) {
    ui.toast('error', result.error.message);
    return;
  }
  const root = result.value[0];
  ui.toast('info', `Deleted ${root?.name ?? 'item'}.`, { label: 'Undo', run: undoTree });
}

export function confirmDelete(id: string | null = useUiStore.getState().selectedNodeId): void {
  const node = id ? useWorkspaceStore.getState().fs[id] : undefined;
  if (!id || !node) return;
  const ui = useUiStore.getState();
  ui.askConfirm({
    title: `Delete ${node.kind}?`,
    message:
      node.kind === 'folder'
        ? `"${node.name}" and everything inside it will be deleted. You can undo this right after.`
        : `"${node.name}" will be deleted. You can undo this right after.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => deleteNode(id),
  });
}

export async function saveAll(): Promise<void> {
  const ui = useUiStore.getState();
  if (useWorkspaceStore.getState().ephemeral) {
    ui.toast('warning', 'Browser storage is unavailable, so nothing can be saved. Export a ZIP to keep your work.');
    return;
  }
  if (useSettingsStore.getState().formatOnSave) await runEditorAction('editor.action.formatDocument');
  const saved = await getPersistence().saveNow();
  if (saved) ui.toast('success', 'Saved.');
}

export function closeActiveTab(): Result<void> {
  const { active, closeTab } = useEditorStore.getState();
  if (!active) return fail('NOT_FOUND', 'No open tab.');
  closeTab(active);
  return ok(undefined);
}
