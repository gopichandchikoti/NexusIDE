import { FONT_SIZE_RANGE, type ThemeChoice } from '@/domain/settings';
import { runEditorAction } from '@/editor/bridge';
import { useEditorStore } from '@/store/editorStore';
import { useRunStore } from '@/store/runStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { closeActiveTab, confirmDelete, promptNew, promptRename, redoTree, saveAll, undoTree } from './fileActions';
import { runProject, stopProject } from './runActions';
import { exportWorkspaceZip, pickZipToImport } from './workspaceActions';

export interface Command {
  readonly id: string;
  readonly title: string;
  readonly category: 'File' | 'Edit' | 'View' | 'Run' | 'Workspace' | 'Settings' | 'Help';
  /** Chord spec, e.g. "Mod+Shift+P" (Mod = Ctrl, or Cmd on macOS) */
  readonly keys?: string;
  /** Additional chords that trigger the same command without being shown */
  readonly alsoKeys?: readonly string[];
  readonly run: () => void | Promise<void>;
}

type Spec = Omit<Command, 'category'>;

const ui = () => useUiStore.getState();
const settings = () => useSettingsStore.getState();
const editorAction = (id: string) => () => void runEditorAction(id);
const inCategory = (category: Command['category'], specs: readonly Spec[]): Command[] =>
  specs.map(spec => ({ ...spec, category }));

function setTheme(theme: ThemeChoice): () => void {
  return () => settings().update({ theme });
}

function nudgeFont(delta: number): () => void {
  return () => {
    const next = settings().fontSize + delta;
    settings().update({ fontSize: Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, next)) });
  };
}

const toggle = (key: 'wordWrap' | 'minimap' | 'lineNumbers' | 'autoSave' | 'formatOnSave') => (): void =>
  settings().update({ [key]: !settings()[key] });

const showPanel = (tab: 'console' | 'problems' | 'terminal') => () => ui().showPanelTab(tab);
const setLayout = (patch: Parameters<ReturnType<typeof ui>['setLayout']>[0]) => () => ui().setLayout(patch);
const toggleLayout = (key: 'showSidebar' | 'showPanel' | 'showPreview') => () => ui().setLayout({ [key]: !ui()[key] });

const fileCommands = (): Command[] =>
  inCategory('File', [
    { id: 'file.new', title: 'New file…', keys: 'Alt+N', run: () => promptNew('file') },
    { id: 'file.newFolder', title: 'New folder…', run: () => promptNew('folder') },
    { id: 'file.rename', title: 'Rename…', keys: 'F2', run: () => promptRename() },
    { id: 'file.delete', title: 'Delete…', run: () => confirmDelete() },
    { id: 'file.save', title: 'Save all', keys: 'Mod+S', run: saveAll },
    { id: 'file.quickOpen', title: 'Go to file…', keys: 'Mod+P', run: () => ui().openPalette('files') },
    { id: 'file.closeTab', title: 'Close tab', keys: 'Alt+W', run: () => void closeActiveTab() },
    { id: 'file.closeAll', title: 'Close all tabs', run: () => useEditorStore.getState().closeAll() },
  ]);

const editCommands = (): Command[] =>
  inCategory('Edit', [
    { id: 'edit.undoTree', title: 'Undo file operation', keys: 'Alt+Z', run: undoTree },
    { id: 'edit.redoTree', title: 'Redo file operation', keys: 'Alt+Shift+Z', run: redoTree },
    {
      id: 'edit.format',
      title: 'Format document',
      keys: 'Alt+Shift+F',
      run: editorAction('editor.action.formatDocument'),
    },
    { id: 'edit.find', title: 'Find in file', run: editorAction('actions.find') },
    { id: 'edit.replace', title: 'Find and replace in file', run: editorAction('editor.action.startFindReplace') },
    {
      id: 'search.global',
      title: 'Search in all files',
      keys: 'Mod+Shift+F',
      run: () => ui().showSidebarPanel('search'),
    },
  ]);

const viewCommands = (): Command[] =>
  inCategory('View', [
    {
      id: 'view.palette',
      title: 'Show all commands',
      keys: 'Mod+Shift+P',
      alsoKeys: ['F1'],
      run: () => ui().openPalette('commands'),
    },
    { id: 'view.explorer', title: 'Show Explorer', keys: 'Mod+Shift+E', run: () => ui().showSidebarPanel('files') },
    { id: 'view.sidebar', title: 'Toggle sidebar', keys: 'Mod+B', run: toggleLayout('showSidebar') },
    { id: 'view.panel', title: 'Toggle bottom panel', keys: 'Mod+J', run: toggleLayout('showPanel') },
    { id: 'view.preview', title: 'Toggle preview', keys: 'Alt+P', run: toggleLayout('showPreview') },
    {
      id: 'view.previewRight',
      title: 'Preview: dock to the right',
      run: setLayout({ previewDock: 'right', showPreview: true }),
    },
    {
      id: 'view.previewBottom',
      title: 'Preview: dock below the editor',
      run: setLayout({ previewDock: 'bottom', showPreview: true }),
    },
    { id: 'view.console', title: 'Show Console', run: showPanel('console') },
    { id: 'view.problems', title: 'Show Problems', keys: 'Mod+Shift+M', run: showPanel('problems') },
    { id: 'view.terminal', title: 'Show Terminal (JavaScript REPL)', keys: 'Mod+`', run: showPanel('terminal') },
  ]);

const runCommands = (): Command[] =>
  inCategory('Run', [
    { id: 'run.run', title: 'Run', keys: 'Mod+Enter', run: runProject },
    { id: 'run.stop', title: 'Stop', keys: 'Mod+Shift+Enter', run: stopProject },
    { id: 'run.clear', title: 'Clear console', run: () => useRunStore.getState().clear() },
  ]);

const workspaceCommands = (): Command[] =>
  inCategory('Workspace', [
    { id: 'workspace.template', title: 'Start from a template…', run: () => ui().setDialog({ templatesOpen: true }) },
    { id: 'workspace.export', title: 'Export workspace as ZIP', run: exportWorkspaceZip },
    { id: 'workspace.import', title: 'Import ZIP…', run: pickZipToImport },
  ]);

const settingsCommands = (): Command[] =>
  inCategory('Settings', [
    { id: 'settings.open', title: 'Open settings', keys: 'Mod+,', run: () => ui().setDialog({ settingsOpen: true }) },
    { id: 'settings.themeSystem', title: 'Theme: follow system', run: setTheme('system') },
    { id: 'settings.themeGraphite', title: 'Theme: Graphite (dark)', run: setTheme('graphite') },
    { id: 'settings.themePaper', title: 'Theme: Paper (light)', run: setTheme('paper') },
    { id: 'settings.themeContrast', title: 'Theme: High contrast', run: setTheme('contrast') },
    { id: 'settings.fontUp', title: 'Increase editor font size', keys: 'Mod+=', run: nudgeFont(1) },
    { id: 'settings.fontDown', title: 'Decrease editor font size', keys: 'Mod+-', run: nudgeFont(-1) },
    { id: 'settings.wordWrap', title: 'Toggle word wrap', run: toggle('wordWrap') },
    { id: 'settings.minimap', title: 'Toggle minimap', run: toggle('minimap') },
    { id: 'settings.autoSave', title: 'Toggle autosave', run: toggle('autoSave') },
  ]);

const helpCommands = (): Command[] =>
  inCategory('Help', [
    {
      id: 'help.shortcuts',
      title: 'Keyboard shortcuts',
      keys: 'Mod+/',
      run: () => ui().setDialog({ shortcutsOpen: true }),
    },
  ]);

export function buildCommands(): readonly Command[] {
  return [
    ...fileCommands(),
    ...editCommands(),
    ...viewCommands(),
    ...runCommands(),
    ...workspaceCommands(),
    ...settingsCommands(),
    ...helpCommands(),
  ];
}
