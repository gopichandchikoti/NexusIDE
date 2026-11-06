import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromEntries, type FsState } from '@/domain/fs';
import { withDb } from '@/services/db';
import { listDrafts, loadWorkspace, putDraft, saveChanges, wipeAllData } from '@/services/workspaceRepo';
import { boot } from './boot';
import { loadSession, useEditorStore } from './editorStore';
import { startPersistence, type PersistenceController } from './persistence';
import { useRecoveryStore } from './recoveryStore';
import { useSettingsStore } from './settingsStore';
import { useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

const FAST = { draftDelayMs: 5, commitDelayMs: 25, structuralDelayMs: 5 };

function seed(files: Record<string, string>): FsState {
  const r = fromEntries(Object.entries(files).map(([path, content]) => ({ path, kind: 'file' as const, content })));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const idOf = (fs: FsState, name: string): string => Object.values(fs).find(n => n.name === name)?.id ?? '';
const contentOf = (name: string): string | undefined =>
  Object.values(useWorkspaceStore.getState().fs).find(n => n.name === name)?.content;

function resetStores(): void {
  useWorkspaceStore.setState({
    fs: {},
    status: 'booting',
    dirty: new Set(),
    past: [],
    future: [],
    saveError: null,
    ephemeral: false,
    lastSavedAt: null,
  });
  useEditorStore.setState({ tabs: [], active: null });
  useRecoveryStore.setState({ drafts: [] });
  useUiStore.setState({ toasts: [] });
  useSettingsStore.getState().reset();
  window.localStorage.clear();
}

beforeEach(async () => {
  await wipeAllData();
  resetStores();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('workspaceStore history', () => {
  const setup = () => {
    useWorkspaceStore.getState().hydrate(seed({ 'a.ts': 'A', 'b.ts': 'B', 'dir/c.ts': 'C' }));
    return useWorkspaceStore.getState();
  };

  it('undo of a delete restores content and does not roll back later edits to other files', () => {
    const ws = setup();
    const aId = idOf(ws.fs, 'a.ts');
    const bId = idOf(ws.fs, 'b.ts');
    ws.setContent(aId, 'A-edited-before-delete');
    expect(ws.remove(aId).ok).toBe(true);
    useWorkspaceStore.getState().setContent(bId, 'B-edited-after-delete');
    const undone = useWorkspaceStore.getState().undo();
    expect(undone).toMatchObject({ ok: true, value: expect.stringContaining('create a.ts') });
    expect(contentOf('a.ts')).toBe('A-edited-before-delete');
    expect(contentOf('b.ts')).toBe('B-edited-after-delete');
  });

  it('undoes and redoes create and rename; a new action clears redo', () => {
    const ws = setup();
    const created = ws.create({ parentId: null, name: 'new.ts', kind: 'file' });
    expect(created.ok).toBe(true);
    useWorkspaceStore.getState().rename(idOf(useWorkspaceStore.getState().fs, 'new.ts'), 'renamed.ts');
    expect(contentOf('renamed.ts')).toBe('');
    useWorkspaceStore.getState().undo();
    expect(contentOf('new.ts')).toBe('');
    useWorkspaceStore.getState().undo();
    expect(contentOf('new.ts')).toBeUndefined();
    useWorkspaceStore.getState().redo();
    expect(contentOf('new.ts')).toBe('');
    useWorkspaceStore.getState().create({ parentId: null, name: 'other.ts', kind: 'file' });
    expect(useWorkspaceStore.getState().future).toHaveLength(0);
    expect(useWorkspaceStore.getState().redo().ok).toBe(false);
  });

  it('undo of deleting a folder restores the whole subtree', () => {
    const ws = setup();
    const dirId = idOf(ws.fs, 'dir');
    ws.remove(dirId);
    expect(contentOf('c.ts')).toBeUndefined();
    useWorkspaceStore.getState().undo();
    expect(contentOf('c.ts')).toBe('C');
  });

  it('leaves history untouched and reports why when an undo cannot be applied', () => {
    const ws = setup();
    ws.remove(idOf(ws.fs, 'a.ts'));
    // A replace (import, backup restore) clears history, so there is nothing stale left to undo.
    useWorkspaceStore.getState().replaceAll(seed({ 'a.ts': 'imported' }));
    expect(useWorkspaceStore.getState().past).toHaveLength(0);
    const r = useWorkspaceStore.getState().undo();
    expect(!r.ok && r.error.message).toBe('Nothing to undo.');
    expect(contentOf('a.ts')).toBe('imported');
  });

  it('refuses oversize content, tracks dirty, and clears dirty when saved', () => {
    const ws = setup();
    const id = idOf(ws.fs, 'a.ts');
    expect(ws.setContent(id, 'x'.repeat(1_000_001)).ok).toBe(false);
    expect(useWorkspaceStore.getState().dirty.size).toBe(0);
    ws.setContent(id, 'ok');
    expect(useWorkspaceStore.getState().dirty.has(id)).toBe(true);
    useWorkspaceStore.getState().markSaved(123);
    expect(useWorkspaceStore.getState().dirty.size).toBe(0);
    expect(useWorkspaceStore.getState().lastSavedAt).toBe(123);
  });
});

describe('editorStore', () => {
  it('opens, activates and closes tabs choosing a sensible neighbour', () => {
    const e = useEditorStore.getState();
    ['a', 'b', 'c'].forEach(id => useEditorStore.getState().openFile(id));
    expect(useEditorStore.getState()).toMatchObject({ tabs: ['a', 'b', 'c'], active: 'c' });
    useEditorStore.getState().setActive('b');
    useEditorStore.getState().closeTab('b');
    expect(useEditorStore.getState()).toMatchObject({ tabs: ['a', 'c'], active: 'c' });
    useEditorStore.getState().openFile('a');
    expect(useEditorStore.getState().tabs).toEqual(['a', 'c']);
    useEditorStore.getState().closeOthers('a');
    expect(useEditorStore.getState().tabs).toEqual(['a']);
    useEditorStore.getState().prune(new Set());
    expect(useEditorStore.getState()).toMatchObject({ tabs: [], active: null });
    useEditorStore.getState().closeAll();
    expect(e.tabs).toEqual([]);
  });

  it('persists the tab session and tolerates corrupt session data', () => {
    useEditorStore.getState().openFile('x');
    expect(loadSession()).toEqual({ tabs: ['x'], active: 'x' });
    window.localStorage.setItem('nexuside.session.v1', '{not json');
    expect(loadSession()).toEqual({ tabs: [], active: null });
    window.localStorage.setItem('nexuside.session.v1', JSON.stringify({ tabs: [1, 'ok'], active: 'zzz' }));
    expect(loadSession()).toEqual({ tabs: ['ok'], active: 'ok' });
  });
});

describe('settings and ui stores', () => {
  it('validates updates and persists them', () => {
    useSettingsStore.getState().update({ fontSize: 999, theme: 'paper' });
    expect(useSettingsStore.getState()).toMatchObject({ fontSize: 28, theme: 'paper' });
    expect(JSON.parse(window.localStorage.getItem('nexuside.settings.v1') ?? '{}')).toMatchObject({ theme: 'paper' });
  });

  it('keeps at most four toasts and dismisses them', () => {
    const ids = [1, 2, 3, 4, 5].map(n => useUiStore.getState().toast('info', `m${n}`));
    expect(useUiStore.getState().toasts).toHaveLength(4);
    useUiStore.getState().dismissToast(ids[4] as number);
    expect(useUiStore.getState().toasts).toHaveLength(3);
  });

  it('persists layout changes', () => {
    useUiStore.getState().setLayout({ previewDock: 'bottom' });
    expect(JSON.parse(window.localStorage.getItem('nexuside.layout.v1') ?? '{}')).toMatchObject({
      previewDock: 'bottom',
    });
  });
});

describe('persistence coordinator', () => {
  let controller: PersistenceController;
  afterEach(() => controller?.stop());

  const start = async (files: Record<string, string>) => {
    const fs = seed(files);
    await saveChanges({}, fs);
    useWorkspaceStore.getState().hydrate(fs);
    controller = startPersistence(FAST);
    controller.setCommitted(fs);
    return fs;
  };

  it('commits autosaved edits, then clears the journaled drafts', async () => {
    const fs = await start({ 'a.txt': 'one' });
    useWorkspaceStore.getState().setContent(idOf(fs, 'a.txt'), 'two');
    await vi.waitFor(async () => {
      const stored = await loadWorkspace();
      expect(stored.ok && Object.values(stored.value.state)[0]?.content).toBe('two');
      const drafts = await listDrafts();
      expect(drafts.ok && drafts.value).toEqual([]);
      expect(useWorkspaceStore.getState().dirty.size).toBe(0);
    });
    expect(useWorkspaceStore.getState().lastSavedAt).not.toBeNull();
  });

  it('with autosave off keeps edits as drafts only until saveNow()', async () => {
    useSettingsStore.getState().update({ autoSave: false });
    const fs = await start({ 'a.txt': 'one' });
    const id = idOf(fs, 'a.txt');
    useWorkspaceStore.getState().setContent(id, 'draft only');
    await vi.waitFor(async () => {
      const drafts = await listDrafts();
      expect(drafts.ok && drafts.value.map(d => d.content)).toEqual(['draft only']);
    });
    await new Promise(r => setTimeout(r, 80));
    const stillOld = await loadWorkspace();
    expect(stillOld.ok && stillOld.value.state[id]?.content).toBe('one');
    expect(await controller.saveNow()).toBe(true);
    const saved = await loadWorkspace();
    expect(saved.ok && saved.value.state[id]?.content).toBe('draft only');
    const drafts = await listDrafts();
    expect(drafts.ok && drafts.value).toEqual([]);
  });

  it('commits structural changes immediately even with autosave off', async () => {
    useSettingsStore.getState().update({ autoSave: false });
    await start({ 'a.txt': '1' });
    useWorkspaceStore.getState().create({ parentId: null, name: 'b.txt', kind: 'file' });
    await vi.waitFor(async () => {
      const stored = await loadWorkspace();
      expect(stored.ok && Object.keys(stored.value.state)).toHaveLength(2);
    });
  });

  it('records a save error and surfaces it once when storage fails', async () => {
    const fs = await start({ 'a.txt': '1' });
    const store = await import('@/services/db');
    const spy = vi.spyOn(store, 'withDb').mockResolvedValue({
      ok: false,
      error: { code: 'QUOTA_EXCEEDED', message: 'Browser storage is full.' },
    });
    useWorkspaceStore.getState().setContent(idOf(fs, 'a.txt'), '2');
    await vi.waitFor(() => expect(useWorkspaceStore.getState().saveError?.code).toBe('QUOTA_EXCEEDED'));
    spy.mockRestore();
  });

  it('does nothing in ephemeral mode (storage unavailable)', async () => {
    useWorkspaceStore.getState().hydrate(seed({ 'a.txt': '1' }), true);
    controller = startPersistence(FAST);
    useWorkspaceStore.getState().setContent(idOf(useWorkspaceStore.getState().fs, 'a.txt'), '2');
    await new Promise(r => setTimeout(r, 60));
    const stored = await loadWorkspace();
    expect(stored.ok && stored.value.hadData).toBe(false);
    expect(await controller.saveNow()).toBe(false);
  });
});

describe('crash recovery (boot)', () => {
  it('offers unsaved edits left by a crashed session, and restores them', async () => {
    const committed = seed({ 'a.txt': 'saved', 'b.txt': 'same' });
    await saveChanges({}, committed);
    await putDraft({ fileId: idOf(committed, 'a.txt'), content: 'typed before crash', savedAt: 5 });
    await putDraft({ fileId: idOf(committed, 'b.txt'), content: 'same', savedAt: 5 });
    await putDraft({ fileId: 'deleted-file', content: 'orphan', savedAt: 5 });

    const controller = startPersistence(FAST);
    const report = await boot(controller);
    expect(report).toMatchObject({ firstRun: false, ephemeral: false, recoverable: 1 });
    expect(useRecoveryStore.getState().drafts.map(d => d.content)).toEqual(['typed before crash']);
    const leftover = await listDrafts();
    expect(leftover.ok && leftover.value.map(d => d.content)).toEqual(['typed before crash']);

    expect(await useRecoveryStore.getState().restore()).toBe(1);
    expect(contentOf('a.txt')).toBe('typed before crash');
    expect(useWorkspaceStore.getState().dirty.size).toBe(1);
    controller.stop();
  });

  it('discarding recovery drops the drafts and keeps the saved text', async () => {
    const committed = seed({ 'a.txt': 'saved' });
    await saveChanges({}, committed);
    await putDraft({ fileId: idOf(committed, 'a.txt'), content: 'unsaved', savedAt: 5 });
    const controller = startPersistence(FAST);
    await boot(controller);
    await useRecoveryStore.getState().discard();
    expect(contentOf('a.txt')).toBe('saved');
    const drafts = await listDrafts();
    expect(drafts.ok && drafts.value).toEqual([]);
    controller.stop();
  });

  it('flags a first run, restores the previous tabs, and warns about corrupt rows', async () => {
    const controller = startPersistence(FAST);
    expect(await boot(controller)).toMatchObject({ firstRun: true });
    controller.stop();

    const committed = seed({ 'a.txt': 'x' });
    await saveChanges({}, committed);
    await withDb(db => db.put('nodes', { id: 'bad', name: 7 } as never));
    resetStores();
    useWorkspaceStore.setState({ status: 'booting' });
    window.localStorage.setItem(
      'nexuside.session.v1',
      JSON.stringify({ tabs: [idOf(committed, 'a.txt'), 'gone'], active: idOf(committed, 'a.txt') })
    );
    const second = startPersistence(FAST);
    const report = await boot(second);
    expect(report.firstRun).toBe(false);
    expect(useEditorStore.getState().tabs).toEqual([idOf(committed, 'a.txt')]);
    expect(useUiStore.getState().toasts.some(t => t.kind === 'warning' && t.message.includes('damaged'))).toBe(true);
    second.stop();
  });
});
