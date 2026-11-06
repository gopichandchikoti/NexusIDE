import { fromEntries, pathOf, toEntries, type FsState } from '@/domain/fs';
import { pickRunTarget } from '@/domain/runTarget';
import { getTemplate, type Template } from '@/data/templates';
import { createBackup, replaceAll, restoreBackup, wipeAllData } from '@/services/workspaceRepo';
import { PREF_KEYS, removePref } from '@/services/prefsStorage';
import { exportZip, importZip } from '@/services/zip';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { getPersistence } from './services';

const toast = useUiStore.getState().toast;

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

function entryToOpen(fs: FsState): string | null {
  const paths = toEntries(fs)
    .filter(e => e.kind === 'file')
    .map(e => e.path);
  const target = pickRunTarget(null, paths);
  const html = target.ok ? target.value.entry : null;
  const readme = paths.find(p => p.toLowerCase() === 'readme.md');
  const preferred = paths.find(p => p.endsWith('App.tsx')) ?? paths.find(p => p.endsWith('main.ts')) ?? html ?? readme;
  const chosen = preferred ?? paths[0];
  return chosen ? (Object.values(fs).find(n => pathOf(fs, n.id) === chosen)?.id ?? null) : null;
}

/** Backs up the current workspace (if any), persists `next`, and swaps it in. Returns false if nothing changed. */
export async function replaceWorkspace(next: FsState, backupLabel: string): Promise<boolean> {
  const current = useWorkspaceStore.getState().fs;
  if (Object.keys(current).length > 0) {
    const backup = await createBackup(current, backupLabel);
    if (!backup.ok) {
      toast('error', `${backup.error.message} Nothing was changed.`);
      return false;
    }
  }
  if (!useWorkspaceStore.getState().ephemeral) {
    const saved = await replaceAll(next);
    if (!saved.ok) {
      toast('error', `${saved.error.message} Nothing was changed.`);
      return false;
    }
  }
  useWorkspaceStore.getState().replaceAll(next);
  getPersistence().setCommitted(next);
  useEditorStore.getState().closeAll();
  const open = entryToOpen(next);
  if (open) useEditorStore.getState().openFile(open);
  return true;
}

function build(files: Template['files']): FsState | null {
  const entries = Object.entries(files).map(([path, content]) => ({ path, kind: 'file' as const, content }));
  const built = fromEntries(entries);
  if (!built.ok) {
    toast('error', built.error.message);
    return null;
  }
  return built.value;
}

export function startFromTemplate(id: Template['id']): void {
  const template = getTemplate(id);
  const next = build(template.files);
  if (!next) return;
  const apply = async (): Promise<void> => {
    if (await replaceWorkspace(next, `Before starting "${template.name}"`)) {
      toast('success', `Started from the ${template.name} template.`);
    }
  };
  const hasWork = Object.keys(useWorkspaceStore.getState().fs).length > 0;
  if (!hasWork) {
    void apply();
    return;
  }
  useUiStore.getState().askConfirm({
    title: 'Replace the current workspace?',
    message: 'Your current files are saved as a backup first (Settings → Data), so you can restore them.',
    confirmLabel: 'Replace with template',
    danger: true,
    onConfirm: () => void apply(),
  });
}

export async function exportWorkspaceZip(): Promise<void> {
  const fs = useWorkspaceStore.getState().fs;
  if (Object.keys(fs).length === 0) {
    toast('info', 'The workspace is empty. Add a file before exporting.');
    return;
  }
  try {
    const bytes = await exportZip(fs);
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), `nexuside-${stamp()}.zip`);
    toast('success', 'Exported a ZIP of your workspace.');
  } catch {
    toast('error', 'Could not create the ZIP file.');
  }
}

export async function importZipFile(file: File): Promise<void> {
  const result = await importZip(file);
  if (!result.ok) {
    toast('error', result.error.message);
    return;
  }
  const count = Object.values(result.value.state).filter(n => n.kind === 'file').length;
  if (count === 0) {
    toast('warning', 'That ZIP contains no text files NexusIDE can open.');
    return;
  }
  const apply = async (): Promise<void> => {
    if (!(await replaceWorkspace(result.value.state, `Before importing ${file.name}`))) return;
    const skipped = result.value.skipped.length;
    toast(
      skipped > 0 ? 'warning' : 'success',
      `Imported ${count} files${skipped > 0 ? `; skipped ${skipped} unsupported` : ''}.`
    );
  };
  if (Object.keys(useWorkspaceStore.getState().fs).length === 0) {
    await apply();
    return;
  }
  useUiStore.getState().askConfirm({
    title: `Replace the workspace with ${file.name}?`,
    message: `Importing ${count} files replaces your current files. They are backed up first (Settings → Data).`,
    confirmLabel: 'Replace with ZIP',
    danger: true,
    onConfirm: () => void apply(),
  });
}

export function pickZipToImport(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,application/zip';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void importZipFile(file);
  };
  input.click();
}

export async function restoreBackupById(id: number): Promise<void> {
  const restored = await restoreBackup(id);
  if (!restored.ok) {
    toast('error', restored.error.message);
    return;
  }
  if (await replaceWorkspace(restored.value, 'Before restoring a backup')) toast('success', 'Backup restored.');
}

export async function wipeEverything(): Promise<void> {
  const result = await wipeAllData();
  if (!result.ok) {
    toast('error', result.error.message);
    return;
  }
  Object.values(PREF_KEYS).forEach(removePref);
  removePref('nexuside.session.v1');
  window.location.reload();
}
