import { toEntries, pathOf } from '@/domain/fs';
import { pickRunTarget } from '@/domain/runTarget';
import { useEditorStore } from '@/store/editorStore';
import { useRunStore } from '@/store/runStore';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { getRunner } from './services';

const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

export async function runProject(): Promise<void> {
  const { fs } = useWorkspaceStore.getState();
  const ui = useUiStore.getState();
  const files: Record<string, string> = {};
  for (const entry of toEntries(fs)) if (entry.kind === 'file') files[entry.path] = entry.content ?? '';
  const activeId = useEditorStore.getState().active;
  const activePath = activeId && fs[activeId] ? pathOf(fs, activeId) : null;
  const target = pickRunTarget(activePath, Object.keys(files));
  const log = useRunStore.getState();
  if (!target.ok) {
    log.log('error', target.error.message);
    ui.toast('warning', target.error.message);
    ui.showPanelTab('console');
    return;
  }
  log.clear();
  if (target.value.mode === 'preview') {
    ui.setLayout({ showPreview: true });
    ui.setMobileView('preview');
    await nextFrame();
  } else {
    ui.showPanelTab('console');
  }
  await getRunner().run(target.value, files);
}

export function stopProject(): void {
  getRunner().stop();
}
