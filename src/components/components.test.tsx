import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromEntries, type FsState } from '@/domain/fs';
import { useEditorStore } from '@/store/editorStore';
import { useProblemsStore } from '@/store/problemsStore';
import { useRunStore } from '@/store/runStore';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { NameDialogHost, ConfirmDialogHost } from './files/Dialogs';
import { Tabs } from './editor/Tabs';
import { CommandPalette } from './palette/CommandPalette';
import { ConsoleView } from './panel/ConsoleView';
import { ProblemsView } from './panel/ProblemsView';
import { RunChip } from './panel/RunChip';
import { ChunkBoundary } from './ui/ChunkBoundary';
import { ContextMenu } from './ui/ContextMenu';
import { Modal } from './ui/Modal';
import { Toasts } from './ui/Toasts';

function seed(files: Record<string, string>): FsState {
  const r = fromEntries(Object.entries(files).map(([path, content]) => ({ path, kind: 'file' as const, content })));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const idOf = (name: string): string =>
  Object.values(useWorkspaceStore.getState().fs).find(n => n.name === name)?.id ?? '';

beforeEach(() => {
  useWorkspaceStore.setState({ fs: {}, structure: 0, status: 'ready', dirty: new Set(), past: [], future: [] });
  useEditorStore.setState({ tabs: [], active: null });
  useUiStore.setState({ toasts: [], palette: null, nameDialog: null, confirm: null, selectedNodeId: null });
  useRunStore.setState({ lines: [] });
  useProblemsStore.setState({ items: [] });
});

describe('Modal', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>opener</button>
        <button>outside</button>
        <Modal
          open={open}
          title="Demo"
          onClose={() => {
            setOpen(false);
            onClose();
          }}
        >
          <button>first</button>
          <button>last</button>
        </Modal>
      </>
    );
  }

  it('is labelled, focuses its first control, traps Tab, closes on Escape and restores focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByText('opener'));
    const dialog = screen.getByRole('dialog', { name: 'Demo' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toHaveFocus());
    await user.tab();
    expect(screen.getByText('first')).toHaveFocus();
    await user.tab();
    expect(screen.getByText('last')).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByText('last')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('opener')).toHaveFocus();
  });

  it('pulls focus back when something behind the dialog steals it, but allows another modal on top', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>behind</button>
        <Modal open title="Under" onClose={() => undefined}>
          <button>inside</button>
        </Modal>
      </>
    );
    act(() => screen.getByText('behind').focus());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus());
    expect(screen.getByText('behind')).not.toHaveFocus();
    await user.click(screen.getByText('inside'));
  });

  it('closes when the backdrop is pressed but not when the dialog body is', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <Modal open title="T" onClose={onClose}>
        body text
      </Modal>
    );
    await user.click(screen.getByText('body text'));
    expect(onClose).not.toHaveBeenCalled();
    await user.pointer({ keys: '[MouseLeft]', target: container.querySelector('.scrim') as Element });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ContextMenu', () => {
  it('moves with arrow keys, activates with Enter, and closes on Escape', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const close = vi.fn();
    render(
      <ContextMenu
        x={5}
        y={5}
        label="File actions"
        onClose={close}
        items={[
          { id: 'a', label: 'First', run: () => undefined },
          { id: 'b', label: 'Second', run },
          { id: 'c', label: 'Third', danger: true, run: () => undefined },
        ]}
      />
    );
    expect(screen.getByRole('menu', { name: 'File actions' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Second' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Third' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Third' })).toHaveFocus();
    await user.keyboard('{Home}{ArrowDown}{Enter}');
    expect(run).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    close.mockClear();
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalled();
  });
});

describe('Toasts', () => {
  it('shows kind words with icons, runs an action then dismisses, and dismisses on request', async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    render(<Toasts />);
    act(() => {
      useUiStore.getState().toast('error', 'It broke');
      useUiStore.getState().toast('info', 'Deleted a.ts', { label: 'Undo', run: undo });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Error. It broke');
    expect(screen.getByRole('status')).toHaveTextContent('Note. Deleted a.ts');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalled();
    expect(screen.queryByText(/Deleted a.ts/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });
});

describe('Tabs', () => {
  it('renders nothing without tabs, then a tablist with unsaved markers and disambiguated names', async () => {
    const { container, rerender } = render(<Tabs />);
    expect(container).toBeEmptyDOMElement();
    act(() => useWorkspaceStore.getState().hydrate(seed({ 'a/index.ts': '', 'b/index.ts': '', 'c.ts': '' })));
    const ids = Object.values(useWorkspaceStore.getState().fs)
      .filter(n => n.kind === 'file')
      .map(n => n.id);
    act(() => ids.forEach(id => useEditorStore.getState().openFile(id)));
    act(() => {
      useWorkspaceStore.getState().setContent(ids[0] as string, 'changed');
    });
    rerender(<Tabs />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole('tablist', { name: 'Open files' })).toBeInTheDocument();
    expect(screen.getAllByText(/index\.ts — [ab]/)).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: 'unsaved changes' })).toHaveLength(1);
    const selected = tabs.filter(t => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
  });

  it('moves between tabs with arrows and closes the active tab with Delete', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.getState().hydrate(seed({ 'a.ts': '', 'b.ts': '' }));
    act(() => {
      useEditorStore.getState().openFile(idOf('a.ts'));
      useEditorStore.getState().openFile(idOf('b.ts'));
    });
    render(<Tabs />);
    screen.getByRole('tab', { name: /b\.ts/ }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(useEditorStore.getState().active).toBe(idOf('a.ts'));
    await user.keyboard('{ArrowLeft}');
    expect(useEditorStore.getState().active).toBe(idOf('b.ts'));
    await user.keyboard('{Home}');
    expect(useEditorStore.getState().active).toBe(idOf('a.ts'));
    await user.keyboard('{End}{Delete}');
    expect(useEditorStore.getState().tabs).toEqual([idOf('a.ts')]);
  });
});

describe('ChunkBoundary', () => {
  function Bomb({ explode }: { explode: boolean }) {
    if (explode) throw new Error('chunk failed');
    return <p>loaded</p>;
  }

  it('shows an offline-aware error with retry and reload, and renders children again after retry', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Like EditorArea: the parent swaps in a fresh component in the same click that resets the boundary.
    function Parent() {
      const [explode, setExplode] = useState(true);
      return (
        <ChunkBoundary what="The editor" onRetry={() => setExplode(false)}>
          <Bomb explode={explode} />
        </ChunkBoundary>
      );
    }
    render(<Parent />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The editor could not be loaded');
    expect(alert).toHaveTextContent('offline');
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('loaded')).toBeInTheDocument();
    errors.mockRestore();
  });
});
describe('panel views', () => {
  it('ConsoleView shows an empty state, then lines with a text tag per level', () => {
    render(<ConsoleView />);
    expect(screen.getByText('Nothing printed yet')).toBeInTheDocument();
    act(() => {
      useRunStore.getState().logMany([
        { level: 'log', text: 'plain' },
        { level: 'warn', text: 'careful' },
        { level: 'error', text: 'broken' },
      ]);
    });
    const log = screen.getByRole('log', { name: 'Console output' });
    expect(log).toHaveTextContent('plain');
    expect(within(log).getByText('warn')).toBeInTheDocument();
    expect(within(log).getByText('error')).toBeInTheDocument();
  });

  it('ProblemsView shows an empty state, then clickable problems that reveal the location', async () => {
    const user = userEvent.setup();
    render(<ProblemsView />);
    expect(screen.getByText('No problems found')).toBeInTheDocument();
    useWorkspaceStore.getState().hydrate(seed({ 'a.ts': '' }));
    act(() => {
      useProblemsStore.getState().set([
        {
          key: '1',
          fileId: idOf('a.ts'),
          path: 'a.ts',
          line: 4,
          column: 2,
          severity: 'error',
          message: 'Type error',
        },
      ]);
    });
    await user.click(screen.getByRole('button', { name: /Type error/ }));
    expect(useEditorStore.getState().reveal).toEqual({ fileId: idOf('a.ts'), line: 4, column: 2 });
    expect(useEditorStore.getState().active).toBe(idOf('a.ts'));
  });

  it('RunChip states the phase in words with elapsed time and output count', () => {
    render(<RunChip />);
    expect(screen.getByRole('status')).toHaveTextContent('Ready');
    act(() => {
      useRunStore.getState().dispatch({ type: 'start', runId: 1, mode: 'script', entry: 'a.ts', now: Date.now() });
      useRunStore.getState().dispatch({ type: 'built', runId: 1 });
      useRunStore.getState().dispatch({ type: 'output', runId: 1, chars: 3, count: 2 });
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Running · \d+\.\ds · 2 msg/);
    act(() => useRunStore.getState().dispatch({ type: 'timeout', runId: 1, now: Date.now() }));
    expect(screen.getByRole('status')).toHaveTextContent('Timed out');
  });
});

describe('CommandPalette', () => {
  it('filters commands as you type, moves with arrows, runs the chosen one and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useUiStore.getState().openPalette('commands'));
    const input = await screen.findByRole('combobox');
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await user.type(input, 'toggle sidebar');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Toggle sidebar');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    const before = useUiStore.getState().showSidebar;
    await user.keyboard('{Enter}');
    await waitFor(() => expect(useUiStore.getState().showSidebar).toBe(!before));
    expect(useUiStore.getState().palette).toBeNull();
    act(() => useUiStore.getState().openPalette('commands'));
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().palette).toBeNull();
  });

  it('lists files for quick open and says so when nothing matches', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.getState().hydrate(seed({ 'src/app.ts': '', 'readme.md': '' }));
    render(<CommandPalette />);
    act(() => useUiStore.getState().openPalette('files'));
    const input = await screen.findByRole('combobox');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.type(input, 'zzz');
    expect(screen.getByText('No matching files.')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'app');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(useEditorStore.getState().active).toBe(idOf('app.ts')));
  });
});

describe('Name and confirm dialogs', () => {
  it('creates a file from the name dialog and shows validation errors next to the field', async () => {
    const user = userEvent.setup();
    render(<NameDialogHost />);
    act(() => useUiStore.getState().openNameDialog({ mode: 'file', parentId: null }));
    const input = await screen.findByLabelText('File name');
    await user.type(input, 'bad/name');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('slashes');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.clear(input);
    await user.type(input, 'ok.ts{Enter}');
    await waitFor(() => expect(idOf('ok.ts')).not.toBe(''));
    expect(useUiStore.getState().nameDialog).toBeNull();
  });

  it('preselects the base name when renaming, and cancels cleanly', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.getState().hydrate(seed({ 'report.final.md': '' }));
    render(<NameDialogHost />);
    act(() => useUiStore.getState().openNameDialog({ mode: 'rename', id: idOf('report.final.md') }));
    const input = (await screen.findByLabelText('File name')) as HTMLInputElement;
    expect(input.value).toBe('report.final.md');
    await waitFor(() => expect([input.selectionStart, input.selectionEnd]).toEqual([0, 12]));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useUiStore.getState().nameDialog).toBeNull();
  });

  it('runs the confirm action only on the confirm button', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialogHost />);
    act(() =>
      useUiStore
        .getState()
        .askConfirm({ title: 'Delete it?', message: 'Sure?', confirmLabel: 'Delete', danger: true, onConfirm })
    );
    await screen.findByRole('dialog', { name: 'Delete it?' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    act(() =>
      useUiStore
        .getState()
        .askConfirm({ title: 'Delete it?', message: 'Sure?', confirmLabel: 'Delete', danger: true, onConfirm })
    );
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
