import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromEntries, type FsState } from '@/domain/fs';
import { getBackupCount } from '@/__tests__/helpers';
import { saveChanges, wipeAllData } from '@/services/workspaceRepo';
import { useEditorStore } from '@/store/editorStore';
import { useRunStore } from '@/store/runStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

const runner = { run: vi.fn(async () => undefined), stop: vi.fn(), active: false };
const persistence = { saveNow: vi.fn(async () => true), setCommitted: vi.fn(), stop: vi.fn() };
const formatAction = vi.fn(async (_id: string) => true);

vi.mock('./services', () => ({
  getRunner: () => runner,
  getPersistence: () => persistence,
  mounts: { preview: null, hidden: null },
}));
vi.mock('@/editor/bridge', () => ({ runEditorAction: (id: string) => formatAction(id) }));

const {
  closeActiveTab,
  confirmDelete,
  defaultParentId,
  deleteNode,
  promptNew,
  promptRename,
  redoTree,
  saveAll,
  submitName,
  undoTree,
} = await import('./fileActions');
const { runProject, stopProject } = await import('./runActions');
const { exportWorkspaceZip, importZipFile, replaceWorkspace, restoreBackupById, startFromTemplate, wipeEverything } =
  await import('./workspaceActions');

function seed(files: Record<string, string>): FsState {
  const r = fromEntries(Object.entries(files).map(([path, content]) => ({ path, kind: 'file' as const, content })));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const idOf = (name: string): string =>
  Object.values(useWorkspaceStore.getState().fs).find(n => n.name === name)?.id ?? '';
const toasts = () => useUiStore.getState().toasts.map(t => `${t.kind}:${t.message}`);

beforeEach(async () => {
  await wipeAllData();
  vi.clearAllMocks();
  useWorkspaceStore.setState({
    fs: {},
    structure: 0,
    status: 'ready',
    dirty: new Set(),
    past: [],
    future: [],
    ephemeral: false,
    saveError: null,
  });
  useEditorStore.setState({ tabs: [], active: null });
  useUiStore.setState({
    toasts: [],
    nameDialog: null,
    confirm: null,
    selectedNodeId: null,
    palette: null,
    templatesOpen: false,
  });
  useRunStore.setState({ lines: [] });
  useSettingsStore.getState().reset();
  window.localStorage.clear();
});

describe('file actions', () => {
  it('opens the name dialog for new items next to the selection, and for rename', () => {
    useWorkspaceStore.getState().hydrate(seed({ 'src/a.ts': '', 'b.ts': '' }));
    const src = idOf('src');
    expect(defaultParentId()).toBeNull();
    useUiStore.getState().selectNode(src);
    expect(defaultParentId()).toBe(src);
    useUiStore.getState().selectNode(idOf('a.ts'));
    expect(defaultParentId()).toBe(src);
    promptNew('file');
    expect(useUiStore.getState().nameDialog).toEqual({ mode: 'file', parentId: src });
    promptRename(idOf('b.ts'));
    expect(useUiStore.getState().nameDialog).toEqual({ mode: 'rename', id: idOf('b.ts') });
    useUiStore.getState().openNameDialog(null);
    promptRename('missing');
    expect(useUiStore.getState().nameDialog).toBeNull();
  });

  it('creates and renames through submitName, returning validation errors to the dialog', () => {
    expect(submitName({ mode: 'file', parentId: null }, 'a.ts').ok).toBe(true);
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(submitName({ mode: 'folder', parentId: null }, 'dir').ok).toBe(true);
    const dup = submitName({ mode: 'file', parentId: null }, 'A.TS');
    expect(!dup.ok && dup.error.code).toBe('DUPLICATE_NAME');
    const bad = submitName({ mode: 'file', parentId: null }, 'x/y');
    expect(!bad.ok && bad.error.code).toBe('INVALID_NAME');
    expect(submitName({ mode: 'rename', id: idOf('a.ts') }, 'b.ts').ok).toBe(true);
    expect(idOf('b.ts')).not.toBe('');
  });

  it('deletes with an Undo toast, confirms first when asked, and undo/redo report their outcome', () => {
    useWorkspaceStore.getState().hydrate(seed({ 'a.ts': 'A' }));
    confirmDelete(idOf('a.ts'));
    const request = useUiStore.getState().confirm;
    expect(request).toMatchObject({ danger: true, confirmLabel: 'Delete' });
    request?.onConfirm();
    expect(idOf('a.ts')).toBe('');
    const undo = useUiStore.getState().toasts.at(-1)?.action;
    expect(undo?.label).toBe('Undo');
    undo?.run();
    expect(idOf('a.ts')).not.toBe('');
    expect(toasts().some(t => t.startsWith('info:Undid'))).toBe(true);
    redoTree();
    expect(toasts().some(t => t.startsWith('info:Redid'))).toBe(true);
    useWorkspaceStore.getState().replaceAll({});
    undoTree();
    expect(toasts().at(-1)).toBe('warning:Nothing to undo.');
    redoTree();
    expect(toasts().at(-1)).toBe('warning:Nothing to redo.');
    deleteNode('missing');
    expect(toasts().at(-1)?.startsWith('error:')).toBe(true);
    confirmDelete('missing');
  });

  it('closes the active tab or reports there is none', () => {
    expect(closeActiveTab().ok).toBe(false);
    useEditorStore.getState().openFile('x');
    expect(closeActiveTab().ok).toBe(true);
    expect(useEditorStore.getState().tabs).toEqual([]);
  });

  it('saves via the persistence controller, formats first when asked, and refuses in session-only mode', async () => {
    await saveAll();
    expect(persistence.saveNow).toHaveBeenCalledTimes(1);
    expect(toasts().at(-1)).toBe('success:Saved.');
    useSettingsStore.getState().update({ formatOnSave: true });
    await saveAll();
    expect(formatAction).toHaveBeenCalledWith('editor.action.formatDocument');
    useWorkspaceStore.setState({ ephemeral: true });
    persistence.saveNow.mockClear();
    await saveAll();
    expect(persistence.saveNow).not.toHaveBeenCalled();
    expect(toasts().at(-1)).toContain('storage is unavailable');
  });
});

describe('run actions', () => {
  it('explains when there is nothing to run and when the language cannot run', async () => {
    await runProject();
    expect(toasts().at(-1)).toContain('Nothing to run');
    expect(runner.run).not.toHaveBeenCalled();
    expect(useUiStore.getState().panelTab).toBe('console');
    useWorkspaceStore.getState().hydrate(seed({ 'main.py': 'print(1)' }));
    useEditorStore.getState().openFile(idOf('main.py'));
    await runProject();
    expect(toasts().at(-1)).toContain('Python');
  });

  it('runs a page in the preview and a console program in the panel, clearing old output first', async () => {
    useRunStore.getState().log('log', 'old output');
    useWorkspaceStore.getState().hydrate(seed({ 'index.html': '<p>x</p>', 'main.ts': 'x' }));
    useEditorStore.getState().openFile(idOf('index.html'));
    await runProject();
    expect(runner.run).toHaveBeenLastCalledWith(
      { mode: 'preview', entry: 'index.html' },
      expect.objectContaining({ 'index.html': '<p>x</p>' })
    );
    expect(useUiStore.getState()).toMatchObject({ showPreview: true, mobileView: 'preview' });
    expect(useRunStore.getState().lines).toEqual([]);
    useWorkspaceStore.getState().hydrate(seed({ 'main.ts': 'x' }));
    useEditorStore.getState().closeAll();
    useEditorStore.getState().openFile(idOf('main.ts'));
    await runProject();
    expect(runner.run).toHaveBeenLastCalledWith({ mode: 'script', entry: 'main.ts' }, { 'main.ts': 'x' });
    stopProject();
    expect(runner.stop).toHaveBeenCalled();
  });
});

describe('workspace actions', () => {
  it('starts from a template immediately on an empty workspace and opens its entry file', async () => {
    startFromTemplate('typescript');
    await vi.waitFor(() => expect(Object.keys(useWorkspaceStore.getState().fs).length).toBeGreaterThan(0));
    expect(idOf('main.ts')).not.toBe('');
    expect(useEditorStore.getState().active).toBe(idOf('main.ts'));
    expect(persistence.setCommitted).toHaveBeenCalled();
    await vi.waitFor(() => expect(toasts().some(t => t.startsWith('success:Started'))).toBe(true));
  });

  it('asks before replacing existing work and takes a backup', async () => {
    useWorkspaceStore.getState().hydrate(seed({ 'mine.txt': 'precious' }));
    await saveChanges({}, useWorkspaceStore.getState().fs);
    startFromTemplate('blank');
    const request = useUiStore.getState().confirm;
    expect(request?.danger).toBe(true);
    expect(idOf('mine.txt')).not.toBe('');
    request?.onConfirm();
    await vi.waitFor(() => expect(idOf('README.md')).not.toBe(''));
    expect(idOf('mine.txt')).toBe('');
    expect(await getBackupCount()).toBe(1);
  });

  it('keeps the workspace unchanged when saving the replacement fails', async () => {
    useWorkspaceStore.getState().hydrate(seed({ 'keep.txt': '1' }));
    const db = await import('@/services/db');
    const spy = vi
      .spyOn(db, 'withDb')
      .mockResolvedValue({ ok: false, error: { code: 'QUOTA_EXCEEDED', message: 'full' } });
    expect(await replaceWorkspace(seed({ 'new.txt': '2' }), 'test')).toBe(false);
    expect(idOf('keep.txt')).not.toBe('');
    expect(toasts().at(-1)).toContain('Nothing was changed');
    spy.mockRestore();
  });

  it('imports a ZIP (asking first when work exists), and reports invalid or empty archives', async () => {
    const JSZip = (await import('jszip')).default;
    const make = async (files: Record<string, string>) => {
      const zip = new JSZip();
      Object.entries(files).forEach(([p, c]) => zip.file(p, c));
      const bytes = await zip.generateAsync({ type: 'uint8array' });
      return new File([bytes as BlobPart], 'p.zip');
    };
    await importZipFile(new File(['not a zip'], 'bad.zip'));
    expect(toasts().at(-1)).toContain('not a valid ZIP');
    await importZipFile(await make({ 'bin.dat': '\u0000\u0001' }));
    expect(toasts().at(-1)).toContain('no text files');
    await importZipFile(await make({ 'a/b.txt': 'one', 'c.txt': 'two' }));
    await vi.waitFor(() => expect(idOf('c.txt')).not.toBe(''));
    expect(toasts().some(t => t.startsWith('success:Imported 2 files'))).toBe(true);
    await importZipFile(await make({ 'z.txt': 'zed' }));
    expect(useUiStore.getState().confirm?.title).toContain('p.zip');
    useUiStore.getState().confirm?.onConfirm();
    await vi.waitFor(() => expect(idOf('z.txt')).not.toBe(''));
    expect(idOf('c.txt')).toBe('');
  });

  it('exports a ZIP only when there is something to export', async () => {
    await exportWorkspaceZip();
    expect(toasts().at(-1)).toContain('empty');
    useWorkspaceStore.getState().hydrate(seed({ 'a.txt': 'x' }));
    const created: Blob[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), 'blob:fake'), revokeObjectURL: vi.fn() })
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await exportWorkspaceZip();
    expect(created).toHaveLength(1);
    expect(click).toHaveBeenCalled();
    expect(toasts().at(-1)).toContain('Exported');
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('restores a backup and reports a missing one', async () => {
    useWorkspaceStore.getState().hydrate(seed({ 'old.txt': 'v1' }));
    await saveChanges({}, useWorkspaceStore.getState().fs);
    await replaceWorkspace(seed({ 'new.txt': 'v2' }), 'before new');
    const { listBackups } = await import('@/services/workspaceRepo');
    const backups = await listBackups();
    const id = backups.ok ? (backups.value[0]?.id as number) : -1;
    await restoreBackupById(id);
    await vi.waitFor(() => expect(idOf('old.txt')).not.toBe(''));
    await restoreBackupById(9999);
    expect(toasts().at(-1)).toContain('no longer exists');
  });

  it('wipes everything, clears preferences and reloads', async () => {
    window.localStorage.setItem('nexuside.settings.v1', '{}');
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    await wipeEverything();
    expect(window.localStorage.getItem('nexuside.settings.v1')).toBeNull();
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('command registry (every command executes)', () => {
  it('runs each registered command without throwing and with the expected effect for the visible ones', async () => {
    const { buildCommands } = await import('./commands');
    useWorkspaceStore.getState().hydrate(seed({ 'index.html': '<p/>', 'a.ts': 'a' }));
    useEditorStore.getState().openFile(idOf('a.ts'));
    const input = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const ran: string[] = [];
    for (const command of buildCommands()) {
      await expect(Promise.resolve(command.run())).resolves.not.toThrow();
      ran.push(command.id);
      useUiStore.setState({
        nameDialog: null,
        confirm: null,
        palette: null,
        settingsOpen: false,
        shortcutsOpen: false,
        templatesOpen: false,
      });
      if (command.id === 'file.closeAll') useEditorStore.getState().openFile(idOf('a.ts'));
    }
    input.mockRestore();
    expect(ran.length).toBeGreaterThanOrEqual(40);
    expect(runner.stop).toHaveBeenCalled();
    expect(persistence.saveNow).toHaveBeenCalled();
    expect(formatAction).toHaveBeenCalledWith('editor.action.formatDocument');
    expect(formatAction).toHaveBeenCalledWith('actions.find');
  });

  it('applies settings and layout commands', async () => {
    const { buildCommands } = await import('./commands');
    const by = (id: string) =>
      buildCommands()
        .find(c => c.id === id)
        ?.run();
    by('settings.themePaper');
    expect(useSettingsStore.getState().theme).toBe('paper');
    by('settings.themeContrast');
    expect(useSettingsStore.getState().theme).toBe('contrast');
    const size = useSettingsStore.getState().fontSize;
    by('settings.fontUp');
    expect(useSettingsStore.getState().fontSize).toBe(size + 1);
    by('settings.fontDown');
    by('settings.fontDown');
    expect(useSettingsStore.getState().fontSize).toBe(size - 1);
    const wrap = useSettingsStore.getState().wordWrap;
    by('settings.wordWrap');
    expect(useSettingsStore.getState().wordWrap).toBe(!wrap);
    by('view.previewBottom');
    expect(useUiStore.getState()).toMatchObject({ previewDock: 'bottom', showPreview: true });
    by('view.problems');
    expect(useUiStore.getState()).toMatchObject({ panelTab: 'problems', showPanel: true });
    by('view.panel');
    expect(useUiStore.getState().showPanel).toBe(false);
    by('help.shortcuts');
    expect(useUiStore.getState().shortcutsOpen).toBe(true);
  });
});
