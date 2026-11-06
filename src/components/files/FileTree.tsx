import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { confirmDelete, promptNew, promptRename } from '@/app/fileActions';
import { ancestorIds, flattenTree, treeKeyAction, type TreeAction, type TreeRow } from '@/domain/treeView';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { EmptyTree, TreeRowItem, TreeToolbar } from './TreeParts';
import { performTreeAction } from './treeActions';

interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly nodeId: string | null;
}

function menuItems(nodeId: string | null): MenuItem[] {
  const node = nodeId ? useWorkspaceStore.getState().fs[nodeId] : undefined;
  const parent = node ? (node.kind === 'folder' ? node.id : node.parentId) : null;
  const base: MenuItem[] = [
    { id: 'new-file', label: 'New file…', run: () => promptNew('file', parent) },
    { id: 'new-folder', label: 'New folder…', run: () => promptNew('folder', parent) },
  ];
  if (!node) return base;
  return [
    ...base,
    { id: 'rename', label: 'Rename…', run: () => promptRename(node.id) },
    { id: 'delete', label: 'Delete…', danger: true, run: () => confirmDelete(node.id) },
  ];
}

/** Which folders are collapsed, which row has focus, and the actions that mouse and keyboard share. */
function useTreeState(active: string | null) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const tree = useRef<HTMLDivElement>(null);

  // Opening a file from the palette, search or problems reveals it in the tree.
  useEffect(() => {
    if (!active) return;
    const hidden = ancestorIds(useWorkspaceStore.getState().fs, active).filter(id => collapsed.has(id));
    if (hidden.length > 0) setCollapsed(prev => new Set([...prev].filter(id => !hidden.includes(id))));
  }, [active, collapsed]);

  const toggle = useCallback((id: string, expand?: boolean): void => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (expand ?? next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const open = useCallback((row: TreeRow): void => {
    useUiStore.getState().selectNode(row.node.id);
    setFocusId(row.node.id);
    if (row.node.kind === 'file') useEditorStore.getState().openFile(row.node.id);
  }, []);

  const focusRow = useCallback((id: string): void => {
    setFocusId(id);
    tree.current?.querySelector<HTMLElement>(`[data-node-id="${id}"]`)?.focus();
  }, []);

  return { collapsed, focusId, setFocusId, tree, toggle, open, focusRow };
}

export function FileTree() {
  const structure = useWorkspaceStore(s => s.structure);
  const active = useEditorStore(s => s.active);
  const selected = useUiStore(s => s.selectedNodeId);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const state = useTreeState(active);
  const { collapsed } = state;
  // Re-read the tree only when its shape changes; text edits do not re-render the explorer.
  const fs = useWorkspaceStore.getState().fs;
  const rows = useMemo(() => flattenTree(fs, collapsed), [fs, collapsed]);
  void structure;

  const perform = (action: TreeAction): void =>
    performTreeAction(action, {
      rows,
      focusRow: state.focusRow,
      open: state.open,
      toggle: state.toggle,
      showMenu: id => {
        const box = state.tree.current?.querySelector<HTMLElement>(`[data-node-id="${id}"]`)?.getBoundingClientRect();
        setMenu({ x: box?.left ?? 0, y: box?.bottom ?? 0, nodeId: id });
      },
    });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = state.focusId ?? selected ?? active;
    const action = treeKeyAction(
      rows,
      rows.findIndex(r => r.node.id === current),
      event.key,
      event.shiftKey
    );
    if (!action) return;
    event.preventDefault();
    perform(action);
  };

  const openMenu = (event: MouseEvent, nodeId: string | null): void => {
    event.preventDefault();
    event.stopPropagation();
    if (nodeId) useUiStore.getState().selectNode(nodeId);
    setMenu({ x: event.clientX, y: event.clientY, nodeId });
  };

  const tabbableId = state.focusId ?? selected ?? active ?? rows[0]?.node.id;
  return (
    <section className="tree" aria-label="Explorer">
      <TreeToolbar selected={selected} />
      {rows.length === 0 ? (
        <EmptyTree />
      ) : (
        <div
          ref={state.tree}
          className="tree__list"
          role="tree"
          aria-label="Workspace files"
          onKeyDown={onKeyDown}
          onContextMenu={event => openMenu(event, null)}
        >
          {rows.map(row => (
            <TreeRowItem
              key={row.node.id}
              row={row}
              selected={selected === row.node.id}
              active={active === row.node.id}
              tabbable={tabbableId === row.node.id}
              onActivate={() => perform({ type: 'open', id: row.node.id, toggle: row.node.kind === 'folder' })}
              onContextMenu={event => openMenu(event, row.node.id)}
              onFocus={() => state.setFocusId(row.node.id)}
            />
          ))}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.nodeId)}
          label="File actions"
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}
